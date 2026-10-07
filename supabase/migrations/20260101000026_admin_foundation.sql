-- ============================================================================
-- Phase 9, foundations: the admin audit log, admin writes only through
-- database functions, and the columns and tables the admin screens need.
--
--   admin_audit_log       every create / update / delete an admin makes on an
--                         admin-managed table: who, when, which row, and the
--                         before and after of each changed column. Written by
--                         one shared trigger; admins read it, nobody writes it
--   write lock-down       browsers lose INSERT / UPDATE / DELETE on every
--                         admin-managed table (privileges revoked, the
--                         *_admin_write policies dropped). Admins change data
--                         only through the security-definer admin_* functions
--                         (this and the next migrations), which check the
--                         role, validate, and run as the admin so the audit
--                         trigger records them
--   archive               menu rows used by past orders, favourites, event
--                         menus, collections, catering or rewards are archived
--                         (hidden from customers, kept for history), never
--                         deleted
--   settings              type and limits per key (enforced by
--                         admin_update_setting), and an owner-confirmation
--                         stamp for the setup checklist
--   site_content          About copy, contact details, social links, the
--                         logo, privacy policy, terms and refund policy, read
--                         by the customer pages
--   setup_tasks           checklist items that are not a setting or content
--                         (the real menu, hours, POS, printers, ...)
--   attention columns     how a flagged order, a failed refund or a failed
--                         email was resolved, by whom, with a note
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The audit log.
-- ----------------------------------------------------------------------------
create table public.admin_audit_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  -- No foreign key: the log outlives the accounts it names. actor_name is the
  -- name (or email) at the time.
  actor_id    uuid not null,
  actor_name  text,
  table_name  text not null,
  -- The row's key as text ("<uuid>", "tax.get_rate", "<product>/<group>").
  row_id      text,
  -- A readable name for the row at the time (product name, promo code, ...).
  row_label   text,
  action      text not null check (action in ('create', 'update', 'delete', 'import')),
  -- {"column": {"from": <old>, "to": <new>}} -- only the columns that changed.
  -- Imports store their summary here instead.
  changes     jsonb not null default '{}'::jsonb,
  summary     text
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc, id desc);
create index admin_audit_log_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index admin_audit_log_row_idx on public.admin_audit_log (table_name, row_id, created_at desc);

alter table public.admin_audit_log enable row level security;

create policy admin_audit_log_admin_read on public.admin_audit_log
  for select to authenticated
  using (public.is_admin());

-- Append-only, for everyone: no client role may write, and the trigger
-- functions below run as the owner.
revoke insert, update, delete, truncate on public.admin_audit_log from anon, authenticated;

comment on table public.admin_audit_log is
  'Every admin create/update/delete on admin-managed tables, with the before/after of changed columns. Written by audit_admin_change(); admins read it.';

-- ----------------------------------------------------------------------------
-- Who is acting. A signed-in admin is auth.uid(); service-role functions that
-- act for an admin name them in a transaction-local setting (app.audit_actor,
-- or app.order_status_actor, which cancel-with-refund already sets).
-- ----------------------------------------------------------------------------
create or replace function public.audit_actor()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    auth.uid(),
    nullif(current_setting('app.audit_actor', true), '')::uuid,
    nullif(current_setting('app.order_status_actor', true), '')::uuid
  );
$$;

revoke execute on function public.audit_actor() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- The trigger. Arguments: the key columns ("id", or "product_id,modifier_group_id"),
-- then any columns never to record (beyond the bookkeeping ones). Records
-- only changes an admin makes; the system (webhook, jobs, seed) and staff
-- have their own histories. `app.audit_suppress = on` (set by the menu
-- import, which logs one summary entry instead) skips row entries.
-- ----------------------------------------------------------------------------
create or replace function public.audit_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.audit_actor();
  actor_role public.user_role;
  actor_label text;
  key_columns text[] := string_to_array(tg_argv[0], ',');
  ignored text[] := array['updated_at', 'updated_by', 'created_at', 'created_by'];
  old_row jsonb;
  new_row jsonb;
  row_data jsonb;
  diff jsonb := '{}'::jsonb;
  col text;
  rid text;
begin
  if actor is null or coalesce(current_setting('app.audit_suppress', true), '') = 'on' then
    return null;
  end if;

  select p.role, coalesce(nullif(btrim(p.full_name), ''), p.email)
    into actor_role, actor_label
    from public.profiles p
   where p.id = actor;
  if actor_role is distinct from 'admin' then
    return null;
  end if;

  if tg_nargs > 1 then
    ignored := ignored || tg_argv[1:tg_nargs - 1];
  end if;
  if tg_op in ('UPDATE', 'DELETE') then old_row := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then new_row := to_jsonb(new); end if;
  row_data := coalesce(new_row, old_row);

  if tg_op = 'UPDATE' then
    for col in select jsonb_object_keys(new_row) loop
      continue when col = any (ignored);
      if new_row -> col is distinct from old_row -> col then
        diff := diff || jsonb_build_object(col, jsonb_build_object('from', old_row -> col, 'to', new_row -> col));
      end if;
    end loop;
    -- Only bookkeeping changed (updated_at): nothing to record.
    if diff = '{}'::jsonb then
      return null;
    end if;
  else
    for col in select jsonb_object_keys(row_data) loop
      continue when col = any (ignored) or row_data -> col = 'null'::jsonb;
      diff := diff || jsonb_build_object(
        col,
        case when tg_op = 'INSERT'
          then jsonb_build_object('from', null, 'to', row_data -> col)
          else jsonb_build_object('from', row_data -> col, 'to', null)
        end
      );
    end loop;
  end if;

  select string_agg(coalesce(row_data ->> k, ''), '/' order by ord)
    into rid
    from unnest(key_columns) with ordinality as t(k, ord);

  insert into public.admin_audit_log (actor_id, actor_name, table_name, row_id, row_label, action, changes)
  values (
    actor,
    actor_label,
    tg_table_name,
    rid,
    left(coalesce(
      row_data ->> 'name', row_data ->> 'code', row_data ->> 'order_number', row_data ->> 'label',
      row_data ->> 'email', row_data ->> 'full_name', row_data ->> 'key', row_data ->> 'kind',
      row_data ->> 'closure_date', row_data ->> 'description'
    ), 120),
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    diff
  );
  return null;
end;
$$;

revoke execute on function public.audit_admin_change() from public, anon, authenticated;

-- One summary entry for a bulk change (the menu import). Called by definer
-- functions only.
create or replace function public.audit_log_entry(
  p_table text,
  p_row_id text,
  p_row_label text,
  p_action text,
  p_summary text,
  p_changes jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := public.audit_actor();
begin
  if actor is null then
    return;
  end if;
  insert into public.admin_audit_log (actor_id, actor_name, table_name, row_id, row_label, action, changes, summary)
  select actor, coalesce(nullif(btrim(p.full_name), ''), p.email), p_table, p_row_id, p_row_label, p_action,
         coalesce(p_changes, '{}'::jsonb), p_summary
    from public.profiles p
   where p.id = actor;
end;
$$;

revoke execute on function public.audit_log_entry(text, text, text, text, text, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- New tables the admin screens edit (created before the triggers attach).
-- ----------------------------------------------------------------------------

-- Customer-facing text and links that used to be hard-coded placeholders.
-- One row per key; the value is plain text (Markdown-free paragraphs for the
-- long ones, an https link, an email, a phone number, or a Storage path for
-- the logo). Public: the customer pages read it.
create table public.site_content (
  key          text primary key check (key in (
                 'about', 'contact_phone', 'contact_email', 'instagram_url', 'facebook_url',
                 'logo_path', 'privacy_policy', 'terms', 'refund_policy'
               )),
  value        text not null default '' check (char_length(value) <= 20000),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create trigger site_content_set_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

alter table public.site_content enable row level security;

create policy site_content_public_read on public.site_content
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.site_content from anon, authenticated;

comment on table public.site_content is
  'About copy, contact details, social links, logo, privacy policy, terms and refund policy. Public read; admins write through admin_save_content().';

-- The catering refund policy was a setting; it is content now.
insert into public.site_content (key, value)
select 'refund_policy', coalesce(value #>> '{}', '')
  from public.settings where key = 'catering.refund_policy'
on conflict (key) do nothing;
delete from public.settings where key = 'catering.refund_policy';

insert into public.site_content (key, value) values
  ('about', 'Drincup Cafe is named for a cup that overflows. Psalm 34:8 invites us to taste and see that the Lord is good, and Psalm 23 speaks of a table prepared and a cup running over. That is the spirit we pour into every drink: generous, warm, and made for sharing.'),
  ('contact_phone', ''),
  ('contact_email', ''),
  ('instagram_url', ''),
  ('facebook_url', ''),
  ('logo_path', ''),
  ('privacy_policy', 'This is placeholder privacy policy text. The cafe will replace it with its reviewed policy before launch.

We collect what we need to take and fulfil your orders: your name, email address and phone number, what you order, and your Overflow Rewards activity. Card payments are handled by Stripe; your card details never reach our servers.

We use your email for receipts and order updates. Marketing emails are sent only if you opt in, and every one has an unsubscribe link.

You can delete your account at any time from the Account page. Past orders are kept for our sales and tax records with your personal details removed.'),
  ('terms', 'These are placeholder terms. The cafe will replace them with its reviewed terms before launch.

Orders are prepared for pickup at the location and time you choose. Prices include item prices and add-ons; Hawaii General Excise Tax is shown separately at checkout.

If something is wrong with your order, please talk to us at the counter or contact us, and we will make it right.'),
  ('refund_policy', 'Cancel free of charge any time before you pay. After payment, ask us to cancel and we''ll be in touch about a full or partial refund.')
on conflict (key) do nothing;

-- Setup checklist items that are neither a setting nor content: things the
-- owner still has to supply or decide. Seeded here, confirmed from
-- /admin/setup.
create table public.setup_tasks (
  key          text primary key check (key ~ '^[a-z0-9_]+$'),
  label        text not null,
  help         text not null,
  -- Where it is changed in the app (or null when it is outside the app).
  edit_href    text check (edit_href is null or edit_href ~ '^/admin(/|$)'),
  sort_order   integer not null default 0,
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

create trigger setup_tasks_set_updated_at
  before update on public.setup_tasks
  for each row execute function public.set_updated_at();

alter table public.setup_tasks enable row level security;

create policy setup_tasks_admin_read on public.setup_tasks
  for select to authenticated using (public.is_admin());

revoke insert, update, delete, truncate on public.setup_tasks from anon, authenticated;

insert into public.setup_tasks (key, label, help, edit_href, sort_order) values
  ('real_menu', 'Real menu and prices', 'The seeded menu is a stand-in. Import the cafe''s menu from a spreadsheet, or edit it item by item.', '/admin/menu/import', 10),
  ('menu_categories', 'Menu categories', 'The categories from the cafe''s "Offerings" page, in the order customers should see them.', '/admin/menu', 20),
  ('product_photos', 'Product photography', 'Photos for each menu item. Items without one show a branded placeholder.', '/admin/menu', 30),
  ('trading_hours', 'Trading hours', 'Seeded as 7:00 AM - 6:00 PM every day.', '/admin/locations', 40),
  ('cafe_pickup_instructions', 'Pickup instructions at the cafe', 'Where customers collect their order, shown on the confirmation screen.', '/admin/locations', 50),
  ('brand_colors', 'Official brand colors', 'Sampled from the current website. Changed in code (src/app/globals.css), not in the app.', null, 60),
  ('brand_fonts', 'Brand typefaces', 'Baloo 2 and Inter stand in for the cafe''s fonts. Changed in code (src/app/layout.tsx).', null, 70),
  ('pos', 'Point of sale', 'Which POS the cafe uses (Square or other). Integration is post-launch.', null, 80),
  ('counter_hardware', 'Counter tablet and printers', 'Tablet model, receipt printer (80 mm) and label printer (57 x 32 mm labels). Print sizes are in Settings, Staff.', '/admin/settings', 90)
on conflict (key) do nothing;

comment on table public.setup_tasks is
  'Setup checklist items that are not settings or site content. Confirmed by the owner on /admin/setup.';

-- ----------------------------------------------------------------------------
-- Archive. Archived rows are inactive (customers never see them) and stay in
-- place for history; restoring clears the stamp and leaves the row inactive
-- until it is switched back on.
-- ----------------------------------------------------------------------------
alter table public.products
  add column archived_at timestamptz,
  add constraint products_archived_inactive check (archived_at is null or not is_active);
alter table public.product_sizes
  add column archived_at timestamptz,
  add constraint product_sizes_archived_inactive check (archived_at is null or not is_active);
alter table public.modifier_groups
  add column archived_at timestamptz,
  add constraint modifier_groups_archived_inactive check (archived_at is null or not is_active);
alter table public.modifier_options
  add column archived_at timestamptz,
  add constraint modifier_options_archived_inactive check (archived_at is null or not is_active);

-- An archived size or option must not stay a default: the customer would be
-- handed something that is not on the menu.
alter table public.product_sizes
  add constraint product_sizes_default_active check (not is_default or is_active);
alter table public.modifier_options
  add constraint modifier_options_default_active check (not is_default or is_active);

-- "Is this option in any past order or favourite?" -- containment on the
-- snapshot JSON, so the archive-or-delete decision does not scan every line.
create index order_items_modifiers_idx on public.order_items using gin (modifiers jsonb_path_ops);
create index favorites_modifiers_idx on public.favorites using gin (modifiers jsonb_path_ops);
create index favorites_product_idx on public.favorites (product_id);
create index catering_request_items_product_idx on public.catering_request_items (product_id) where product_id is not null;
create index catering_quote_lines_product_idx on public.catering_quote_lines (product_id) where product_id is not null;

-- ----------------------------------------------------------------------------
-- Settings: type and limits per key, and owner confirmation.
--
-- value_type    integer | number | boolean | text | email | number_list | zip_list
-- min_value     integer/number: the smallest value; text/email: the shortest
--               length; number_list: the smallest item
-- max_value     the largest value / longest text / largest list item
--
-- admin_update_setting() refuses anything else. The registry in
-- src/lib/settings/registry.ts holds the same rules plus labels and help
-- text; src/lib/settings/registry.test.ts checks the two agree.
-- ----------------------------------------------------------------------------
alter table public.settings
  add column value_type text check (value_type in ('integer', 'number', 'boolean', 'text', 'email', 'number_list', 'zip_list')),
  add column min_value numeric,
  add column max_value numeric,
  add column confirmed_at timestamptz,
  add column confirmed_by uuid references public.profiles (id) on delete set null;

insert into public.settings (key, value, description, is_public) values
  ('tax.tips_taxed', 'false'::jsonb,
   'Whether GET is charged on tips as well as the order. Assumption: no. NEEDS_CONFIRMATION.', true),
  ('orders.order_ahead_while_closed', 'false'::jsonb,
   'While a location is closed (not paused), let customers add to their cart and schedule a pickup for the next opening. NEEDS_CONFIRMATION.', true),
  ('notifications.reply_to_email', '""'::jsonb,
   'Replies to customer emails go here. Empty = replies go to the sending address. NEEDS_CONFIRMATION.', false)
on conflict (key) do nothing;

-- registry:start (parsed by src/lib/settings/registry.test.ts; one row per line)
update public.settings s
   set value_type = r.value_type, min_value = r.min_value, max_value = r.max_value
  from (values
    ('tax.get_rate', 'number', 0, 0.2),
    ('tax.tips_taxed', 'boolean', null, null),
    ('tip.presets', 'number_list', 0, 100),
    ('tip.default_preset', 'integer', 0, 100),
    ('tip.custom_max_cents', 'integer', 0, 100000),
    ('tip.custom_max_percent', 'integer', 0, 200),
    ('orders.accepting_online_orders', 'boolean', null, null),
    ('orders.queue_minutes_per_order', 'integer', 0, 30),
    ('orders.max_orders_per_slot', 'integer', 0, 100),
    ('orders.last_slot_buffer_minutes', 'integer', 0, 120),
    ('orders.scheduling_slot_minutes', 'integer', 5, 60),
    ('orders.order_ahead_while_closed', 'boolean', null, null),
    ('orders.pending_expiry_minutes', 'integer', 10, 240),
    ('store.pickup_instructions', 'text', 0, 300),
    ('staff.ticket_warning_minutes', 'integer', 1, 60),
    ('staff.ticket_late_minutes', 'integer', 1, 120),
    ('staff.new_order_repeat_seconds', 'integer', 5, 300),
    ('staff.receipt_width_mm', 'integer', 40, 120),
    ('staff.label_width_mm', 'integer', 20, 150),
    ('staff.label_height_mm', 'integer', 15, 150),
    ('catering.min_lead_time_hours', 'integer', 1, 720),
    ('catering.payment_deadline_hours', 'integer', 0, 336),
    ('catering.quote_valid_days', 'integer', 1, 60),
    ('catering.delivery_offered', 'boolean', null, null),
    ('catering.delivery_zip_codes', 'zip_list', null, null),
    ('catering.delivery_fee_cents', 'integer', 0, 100000),
    ('catering.delivery_fee_taxable', 'boolean', null, null),
    ('catering.gratuity_taxable', 'boolean', null, null),
    ('catering.admin_notification_email', 'email', 1, 254),
    ('catering.reminder_enabled', 'boolean', null, null),
    ('catering.reminder_hours_before', 'integer', 1, 168),
    ('loyalty.program_name', 'text', 2, 40),
    ('loyalty.points_per_dollar', 'number', 0, 100),
    ('loyalty.max_rewards_per_order', 'integer', 1, 5),
    ('loyalty.allow_promo_with_reward', 'boolean', null, null),
    ('loyalty.catering_earns_points', 'boolean', null, null),
    ('loyalty.points_expire_after_months', 'integer', 0, 60),
    ('notifications.reply_to_email', 'email', 0, 254)
  ) as r (key, value_type, min_value, max_value)
 where s.key = r.key;
-- registry:end

-- ----------------------------------------------------------------------------
-- Attention queue: how each item was resolved.
-- ----------------------------------------------------------------------------
alter table public.orders
  add column review_resolved_at timestamptz,
  add column review_resolved_by uuid references public.profiles (id) on delete set null,
  add column review_note text check (review_note is null or char_length(review_note) <= 1000);

alter table public.refunds
  add column handled_at timestamptz,
  add column handled_by uuid references public.profiles (id) on delete set null,
  add column handled_note text check (handled_note is null or char_length(handled_note) <= 1000);

alter table public.email_outbox
  add column dismissed_at timestamptz,
  add column dismissed_by uuid references public.profiles (id) on delete set null,
  add column dismissed_note text check (dismissed_note is null or char_length(dismissed_note) <= 1000),
  -- Who asked for a resend (admin "Resend receipt").
  add column requested_by uuid references public.profiles (id) on delete set null;

alter table public.catering_requests
  add column review_resolved_at timestamptz,
  add column review_resolved_by uuid references public.profiles (id) on delete set null,
  add column review_note text check (review_note is null or char_length(review_note) <= 1000);

create index orders_flagged_idx on public.orders (flagged_for_review_at)
  where flagged_for_review_at is not null and review_resolved_at is null;

-- ----------------------------------------------------------------------------
-- Admins change admin-managed tables only through definer functions.
--
-- The policies that let an admin session write these tables directly go, and
-- so do the privileges (a missing policy can then never quietly become a
-- permissive one). Reads are unchanged. The service role (webhook, jobs,
-- seed) is unaffected.
-- ----------------------------------------------------------------------------
drop policy if exists categories_admin_write on public.categories;
drop policy if exists products_admin_write on public.products;
drop policy if exists product_sizes_admin_write on public.product_sizes;
drop policy if exists modifier_groups_admin_write on public.modifier_groups;
drop policy if exists modifier_options_admin_write on public.modifier_options;
drop policy if exists product_modifier_groups_admin_write on public.product_modifier_groups;
drop policy if exists event_menu_items_admin_write on public.event_menu_items;
drop policy if exists collections_admin_write on public.collections;
drop policy if exists collection_products_admin_write on public.collection_products;
drop policy if exists locations_admin_write on public.locations;
drop policy if exists location_hours_admin_write on public.location_hours;
drop policy if exists closures_admin_write on public.closures;
drop policy if exists promos_admin_only on public.promos;
drop policy if exists promo_redemptions_admin_write on public.promo_redemptions;
drop policy if exists rewards_admin_write on public.rewards;
drop policy if exists settings_admin_write on public.settings;
drop policy if exists staff_locations_admin_write on public.staff_locations;
drop policy if exists profiles_admin_all on public.profiles;

-- Promos stay unreadable to customers (codes cannot be enumerated).
create policy promos_admin_read on public.promos
  for select to authenticated using (public.is_admin());

-- A customer edits only their own profile, and only the columns granted
-- below; roles change through admin_set_role().
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (full_name, first_name, phone, marketing_opt_in, sms_opt_in, notification_prefs)
  on public.profiles to authenticated;

revoke insert, update, delete, truncate on
  public.categories, public.products, public.product_sizes, public.modifier_groups, public.modifier_options,
  public.product_modifier_groups, public.event_menu_items, public.collections, public.collection_products,
  public.locations, public.location_hours, public.closures, public.promos, public.promo_redemptions,
  public.rewards, public.settings, public.staff_locations
  from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Attach the audit trigger.
-- ----------------------------------------------------------------------------
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function public.audit_admin_change('id');
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_admin_change('id');
create trigger product_sizes_audit after insert or update or delete on public.product_sizes
  for each row execute function public.audit_admin_change('id');
create trigger modifier_groups_audit after insert or update or delete on public.modifier_groups
  for each row execute function public.audit_admin_change('id');
create trigger modifier_options_audit after insert or update or delete on public.modifier_options
  for each row execute function public.audit_admin_change('id');
create trigger product_modifier_groups_audit after insert or update or delete on public.product_modifier_groups
  for each row execute function public.audit_admin_change('product_id,modifier_group_id');
create trigger event_menu_items_audit after insert or update or delete on public.event_menu_items
  for each row execute function public.audit_admin_change('location_id,product_id');
create trigger collections_audit after insert or update or delete on public.collections
  for each row execute function public.audit_admin_change('id');
create trigger collection_products_audit after insert or update or delete on public.collection_products
  for each row execute function public.audit_admin_change('collection_id,product_id');
create trigger locations_audit after insert or update or delete on public.locations
  for each row execute function public.audit_admin_change('id');
create trigger location_hours_audit after insert or update or delete on public.location_hours
  for each row execute function public.audit_admin_change('id');
create trigger closures_audit after insert or update or delete on public.closures
  for each row execute function public.audit_admin_change('id');
create trigger location_availability_audit after insert or update or delete on public.location_availability
  for each row execute function public.audit_admin_change('id');
create trigger promos_audit after insert or update or delete on public.promos
  for each row execute function public.audit_admin_change('id');
create trigger rewards_audit after insert or update or delete on public.rewards
  for each row execute function public.audit_admin_change('id');
create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function public.audit_admin_change('key');
create trigger site_content_audit after insert or update or delete on public.site_content
  for each row execute function public.audit_admin_change('key');
create trigger setup_tasks_audit after insert or update or delete on public.setup_tasks
  for each row execute function public.audit_admin_change('key');
-- Never the member code (it is a bearer credential for the future scanner)
-- or the cached balance (point changes are their own audited rows).
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_admin_change('id', 'member_code', 'member_code_updated_at', 'loyalty_points');
create trigger staff_locations_audit after insert or update or delete on public.staff_locations
  for each row execute function public.audit_admin_change('profile_id,location_id');
create trigger orders_audit after update on public.orders
  for each row execute function public.audit_admin_change('id', 'checkout_fingerprint');
create trigger refunds_audit after insert or update on public.refunds
  for each row execute function public.audit_admin_change('id');
create trigger email_outbox_audit after update on public.email_outbox
  for each row execute function public.audit_admin_change('id', 'locked_at');
create trigger email_outbox_resend_audit after insert on public.email_outbox
  for each row when (new.requested_by is not null)
  execute function public.audit_admin_change('id');
-- Only manual adjustments: earns, redemptions and the rest are the system's.
create trigger loyalty_transactions_audit after insert on public.loyalty_transactions
  for each row when (new.type = 'adjust')
  execute function public.audit_admin_change('id');

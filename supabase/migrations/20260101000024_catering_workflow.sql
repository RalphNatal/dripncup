-- ============================================================================
-- Phase 8: the catering workflow.
--
--   settings                every catering rule the cafe has not confirmed
--                           (payment deadline, delivery, fees, reminders,
--                           where admin notifications go) is a setting
--   catering_requests       a link to the current quote, cancellation
--                           requests, an unread marker for the admin inbox,
--                           who changed it last
--   catering_quotes         versioned, immutable quotes; one active at a
--                           time, every earlier version kept
--   catering_quote_lines    menu and custom lines, snapshot prices
--   catering_messages       change requests, cancellation requests, notes
--   catering_status_history every status change with its actor
--   payments / refunds      may belong to a catering request instead of an
--                           order (exactly one of the two)
--   email_outbox            catering emails, to the customer and the admin
--   functions               every status change goes through a definer
--                           function with the transition rules; customers
--                           and admins have no direct write access
--
-- Lifecycle: submitted -> quoted -> confirmed -> fulfilled, cancelled from
-- any state before fulfilled. A change request moves quoted back to
-- submitted. See ARCHITECTURE.md, "Catering workflow".
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Settings. NEEDS_CONFIRMATION with the owner unless noted.
-- ----------------------------------------------------------------------------
insert into public.settings (key, value, description, is_public) values
  ('catering.payment_deadline_hours', '48'::jsonb,
   'A catering quote cannot be paid later than this many hours before the event. NEEDS_CONFIRMATION.', true),
  ('catering.quote_valid_days', '7'::jsonb,
   'A new quote can be paid for this many days (never past the payment deadline). NEEDS_CONFIRMATION.', true),
  ('catering.delivery_offered', 'true'::jsonb,
   'Whether customers may ask for delivery. Assumption: yes. NEEDS_CONFIRMATION.', true),
  ('catering.delivery_zip_codes',
   '["96701","96706","96707","96709","96712","96717","96730","96731","96734","96744","96759","96762","96782","96786","96789","96791","96792","96795","96797","96813","96814","96815","96816","96817","96818","96819","96821","96822","96825","96826","96853","96857","96858","96859","96860","96861","96863"]'::jsonb,
   'ZIP codes catering delivers to. Default: Oahu street-delivery ZIP codes. NEEDS_CONFIRMATION.', true),
  ('catering.delivery_fee_cents', '2500'::jsonb,
   'Default delivery fee on a catering quote, in cents; editable per quote. NEEDS_CONFIRMATION.', true),
  ('catering.delivery_fee_taxable', 'true'::jsonb,
   'Whether GET is charged on the catering delivery fee. NEEDS_CONFIRMATION.', true),
  ('catering.gratuity_taxable', 'false'::jsonb,
   'Whether GET is charged on a catering gratuity (tips are not taxed at checkout). NEEDS_CONFIRMATION.', true),
  ('catering.reminder_enabled', 'true'::jsonb,
   'Email the customer a reminder before a confirmed catering event.', false),
  ('catering.reminder_hours_before', '24'::jsonb,
   'How many hours before the event the reminder goes out.', false),
  ('catering.admin_notification_email', '"catering@drincup.test"'::jsonb,
   'Where new catering requests, change requests and payments are announced. Placeholder address. NEEDS_CONFIRMATION.', false),
  ('catering.refund_policy',
   '"Cancel free of charge any time before you pay. After payment, ask us to cancel and we''ll be in touch about a full or partial refund."'::jsonb,
   'Catering cancellation and refund policy shown to customers. Placeholder wording. NEEDS_CONFIRMATION.', true)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Requests and their items.
-- ----------------------------------------------------------------------------
alter table public.catering_requests
  drop constraint catering_quoted_needs_amount,
  add column delivery_postal_code text
    check (delivery_postal_code is null or delivery_postal_code ~ '^[0-9]{5}$'),
  add column current_quote_id uuid,
  -- A customer asking to cancel after paying; only an admin can cancel then.
  add column cancellation_requested_at timestamptz,
  add column cancellation_request_reason text check (char_length(cancellation_request_reason) <= 1000),
  -- The admin inbox's "new" marker: something happened the admin has not
  -- opened since (submitted, changes asked for, paid, cancellation asked for).
  add column admin_attention_at timestamptz,
  add column admin_seen_at timestamptz,
  -- A payment that did not match the quote (amount or currency).
  add column flagged_for_review_at timestamptz,
  add column review_reason text,
  add column created_by uuid references public.profiles (id) on delete set null,
  add column updated_by uuid references public.profiles (id) on delete set null,
  add constraint catering_headcount_sane check (headcount <= 5000),
  add constraint catering_text_lengths check (
    char_length(coalesce(notes, '')) <= 2000
    and char_length(coalesce(custom_drink_request, '')) <= 1000
    and char_length(coalesce(delivery_address, '')) <= 300
  );

create index catering_requests_attention_idx on public.catering_requests (admin_attention_at desc);
create index catering_requests_created_idx on public.catering_requests (created_at desc);

alter table public.catering_request_items
  add column product_size_id uuid references public.product_sizes (id) on delete set null,
  add column size_name text,
  add constraint catering_request_items_quantity_sane check (quantity <= 5000);

-- ----------------------------------------------------------------------------
-- Quotes. Immutable once issued: a revision is a new version and the old one
-- is kept, superseded. Totals come from calculateCateringQuote on the server
-- (src/lib/pricing/catering-quote.ts); the checks below make a quote that
-- does not add up impossible to store.
-- ----------------------------------------------------------------------------
create table public.catering_quotes (
  id                   uuid primary key default gen_random_uuid(),
  catering_request_id  uuid not null references public.catering_requests (id) on delete cascade,
  version              integer not null check (version >= 1),
  -- active: the one the customer can pay. superseded: replaced by a later
  -- version or sent back with a change request. paid. void: the request was
  -- cancelled while it was active.
  status               text not null default 'active'
                       check (status in ('active', 'superseded', 'paid', 'void')),

  items_subtotal_cents integer not null check (items_subtotal_cents >= 0),
  discount_cents       integer not null default 0 check (discount_cents >= 0),
  discount_label       text check (char_length(discount_label) <= 80),
  delivery_fee_cents   integer not null default 0 check (delivery_fee_cents >= 0),
  delivery_fee_taxable boolean not null default true,
  taxable_cents        integer not null check (taxable_cents >= 0),
  tax_rate             numeric(7, 5) not null check (tax_rate >= 0 and tax_rate < 1),
  tax_cents            integer not null check (tax_cents >= 0),
  gratuity_percent     numeric(5, 2) check (gratuity_percent is null or gratuity_percent between 0 and 100),
  gratuity_cents       integer not null default 0 check (gratuity_cents >= 0),
  gratuity_taxable     boolean not null default false,
  total_cents          integer not null check (total_cents >= 0),

  -- After this the quote can no longer be paid; the admin can reissue it.
  expires_at           timestamptz not null,
  -- event_at - catering.payment_deadline_hours, fixed when the quote is made.
  payment_deadline_at  timestamptz not null,
  note_to_customer     text check (char_length(note_to_customer) <= 2000),

  superseded_at        timestamptz,
  superseded_reason    text,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),

  unique (catering_request_id, version),
  constraint catering_quotes_discount_within_items check (discount_cents <= items_subtotal_cents),
  constraint catering_quotes_expiry_before_deadline check (expires_at <= payment_deadline_at),
  constraint catering_quotes_total_adds_up check (
    total_cents = items_subtotal_cents - discount_cents + delivery_fee_cents + tax_cents + gratuity_cents
  )
);

-- One payable quote per request at any time.
create unique index catering_quotes_one_active_idx
  on public.catering_quotes (catering_request_id) where status = 'active';

create table public.catering_quote_lines (
  id               uuid primary key default gen_random_uuid(),
  quote_id         uuid not null references public.catering_quotes (id) on delete cascade,
  -- product: from the menu (prefilled at menu price, editable for catering
  -- pricing). custom: free text, e.g. "Signature drink: Lilikoʻi Sunrise".
  kind             text not null check (kind in ('product', 'custom')),
  product_id       uuid references public.products (id) on delete set null,
  product_size_id  uuid references public.product_sizes (id) on delete set null,
  -- Snapshot, so renaming a drink never rewrites a quote.
  description      text not null check (char_length(description) between 1 and 200),
  size_name        text,
  quantity         integer not null check (quantity between 1 and 10000),
  unit_price_cents integer not null check (unit_price_cents between 0 and 1000000),
  line_total_cents integer not null,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),

  constraint catering_quote_lines_total check (line_total_cents = quantity * unit_price_cents)
);

create index catering_quote_lines_quote_idx on public.catering_quote_lines (quote_id, sort_order);
create index catering_quotes_request_idx on public.catering_quotes (catering_request_id, version desc);

-- Requests quoted the Phase 1 way (one amount, no lines) become version 1 of
-- an itemised quote with a single line, so every quoted request has a quote.
-- Paid already if confirmed or fulfilled.
with backfilled as (
  insert into public.catering_quotes (
    catering_request_id, version, status, items_subtotal_cents, taxable_cents, tax_rate, tax_cents,
    total_cents, expires_at, payment_deadline_at, note_to_customer, created_at
  )
  select c.id, 1,
         case when c.status = 'quoted' then 'active' else 'paid' end,
         c.quote_amount_cents, c.quote_amount_cents, 0, 0, c.quote_amount_cents,
         c.event_at - interval '48 hours', c.event_at - interval '48 hours',
         c.quote_notes, coalesce(c.quoted_at, c.created_at)
    from public.catering_requests c
   where c.status in ('quoted', 'confirmed', 'fulfilled') and c.quote_amount_cents is not null
  returning id, catering_request_id, total_cents
),
lines as (
  insert into public.catering_quote_lines (quote_id, kind, description, quantity, unit_price_cents, line_total_cents)
  select id, 'custom', 'Catering (quoted before itemised quotes)', 1, total_cents, total_cents from backfilled
)
update public.catering_requests c
   set current_quote_id = b.id
  from backfilled b
 where b.catering_request_id = c.id;

-- Superseded by catering_quotes: the amount, the note and Stripe's hosted
-- payment link were the Phase 1 sketch of quoting.
alter table public.catering_requests
  drop column quote_amount_cents,
  drop column quote_notes,
  drop column payment_link_url;

alter table public.catering_requests
  add constraint catering_requests_current_quote_fk
    foreign key (current_quote_id) references public.catering_quotes (id) on delete set null,
  -- Quoted onwards there is always a quote to point at.
  add constraint catering_quoted_needs_quote check (
    status not in ('quoted', 'confirmed', 'fulfilled') or current_quote_id is not null
  );

-- Only the status and the superseded stamp ever change on a quote; lines
-- never change.
create or replace function public.freeze_catering_quote()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - array['status', 'superseded_at', 'superseded_reason', 'created_by'])
     is distinct from (to_jsonb(old) - array['status', 'superseded_at', 'superseded_reason', 'created_by']) then
    raise exception 'A catering quote cannot be changed once issued; issue a new version'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger catering_quotes_freeze
  before update on public.catering_quotes
  for each row execute function public.freeze_catering_quote();

create or replace function public.freeze_catering_quote_lines()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- `product_id` / `product_size_id` going null when a product is deleted
  -- (ON DELETE SET NULL) is allowed; nothing else.
  if (to_jsonb(new) - array['product_id', 'product_size_id']) is distinct from (to_jsonb(old) - array['product_id', 'product_size_id'])
     or (new.product_id is not null and new.product_id is distinct from old.product_id)
     or (new.product_size_id is not null and new.product_size_id is distinct from old.product_size_id) then
    raise exception 'Quote lines cannot be changed once issued' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger catering_quote_lines_freeze
  before update on public.catering_quote_lines
  for each row execute function public.freeze_catering_quote_lines();

-- ----------------------------------------------------------------------------
-- Messages: change requests and cancellation requests from the customer,
-- notes to the customer sent with a quote.
-- ----------------------------------------------------------------------------
create table public.catering_messages (
  id                  uuid primary key default gen_random_uuid(),
  catering_request_id uuid not null references public.catering_requests (id) on delete cascade,
  author_id           uuid references public.profiles (id) on delete set null,
  author_role         text not null check (author_role in ('customer', 'admin', 'system')),
  kind                text not null check (kind in ('change_request', 'cancellation_request', 'quote_note', 'note')),
  body                text not null check (char_length(body) between 1 and 2000),
  quote_id            uuid references public.catering_quotes (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index catering_messages_request_idx on public.catering_messages (catering_request_id, created_at);

-- ----------------------------------------------------------------------------
-- Status history, written by trigger like order_status_history. The actor is
-- auth.uid(), or the admin a service-role function names in the
-- transaction-local `app.catering_actor`; null is the system (webhook).
-- ----------------------------------------------------------------------------
create table public.catering_status_history (
  id                  uuid primary key default gen_random_uuid(),
  catering_request_id uuid not null references public.catering_requests (id) on delete cascade,
  from_status         public.catering_status,
  to_status           public.catering_status not null,
  changed_by          uuid references public.profiles (id) on delete set null,
  reason              text,
  created_at          timestamptz not null default now()
);

create index catering_status_history_request_idx on public.catering_status_history (catering_request_id, created_at);

-- ----------------------------------------------------------------------------
-- Transitions. CATERING_TRANSITIONS in src/lib/catering/status.ts mirrors
-- this, and a unit test fails if they differ.
-- ----------------------------------------------------------------------------
create or replace function public.is_valid_catering_transition(
  from_status public.catering_status,
  to_status public.catering_status
)
returns boolean
language sql
immutable
as $$
  select case from_status
    when 'submitted' then to_status in ('quoted', 'cancelled')
    when 'quoted'    then to_status in ('submitted', 'confirmed', 'cancelled')
    when 'confirmed' then to_status in ('fulfilled', 'cancelled')
    when 'fulfilled' then false
    when 'cancelled' then false
    else false
  end;
$$;

create or replace function public.enforce_catering_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.is_valid_catering_transition(old.status, new.status) then
    raise exception 'Invalid catering status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  case new.status
    when 'quoted'    then new.quoted_at    := coalesce(new.quoted_at, now());
    when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now());
    when 'fulfilled' then new.fulfilled_at := coalesce(new.fulfilled_at, now());
    when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
    else null;
  end case;

  return new;
end;
$$;

create or replace function public.record_catering_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := coalesce(auth.uid(), nullif(current_setting('app.catering_actor', true), '')::uuid);
  reason text := nullif(current_setting('app.catering_reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into public.catering_status_history (catering_request_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, coalesce(actor, new.created_by));
  elsif new.status is distinct from old.status then
    insert into public.catering_status_history (catering_request_id, from_status, to_status, changed_by, reason)
    values (new.id, old.status, new.status, actor,
            coalesce(reason, case when new.status = 'cancelled' then new.cancellation_reason end));
  end if;
  return new;
end;
$$;

create trigger catering_requests_record_status_change
  after insert or update of status on public.catering_requests
  for each row execute function public.record_catering_status_change();

-- Every change records who made it (customer functions run as the customer,
-- admin functions name the admin). An admin opening the request (the
-- inbox's seen marker) is not a change to it.
create or replace function public.stamp_catering_updated_by()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (to_jsonb(new) - array['admin_seen_at', 'updated_at', 'updated_by'])
     = (to_jsonb(old) - array['admin_seen_at', 'updated_at', 'updated_by']) then
    new.updated_at := old.updated_at;
    new.updated_by := old.updated_by;
    return new;
  end if;
  new.updated_by := coalesce(
    auth.uid(),
    nullif(current_setting('app.catering_actor', true), '')::uuid,
    new.updated_by
  );
  return new;
end;
$$;

create trigger catering_requests_stamp_updated_by
  before update on public.catering_requests
  for each row execute function public.stamp_catering_updated_by();

-- ----------------------------------------------------------------------------
-- Payments and refunds can now belong to a catering request. Exactly one of
-- order_id / catering_request_id.
-- ----------------------------------------------------------------------------
alter table public.payments
  alter column order_id drop not null,
  add column catering_request_id uuid references public.catering_requests (id) on delete cascade,
  add column catering_quote_id uuid references public.catering_quotes (id) on delete set null,
  add constraint payments_one_owner check ((order_id is null) <> (catering_request_id is null));

create index payments_catering_idx on public.payments (catering_request_id) where catering_request_id is not null;

alter table public.refunds
  alter column order_id drop not null,
  add column catering_request_id uuid references public.catering_requests (id) on delete cascade,
  add constraint refunds_one_owner check ((order_id is null) <> (catering_request_id is null));

create index refunds_catering_idx on public.refunds (catering_request_id) where catering_request_id is not null;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = payments.order_id and o.user_id = auth.uid())
    or exists (select 1 from public.catering_requests c where c.id = payments.catering_request_id and c.user_id = auth.uid())
  );

drop policy if exists refunds_select on public.refunds;
create policy refunds_select on public.refunds
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
    or exists (select 1 from public.catering_requests c where c.id = refunds.catering_request_id and c.user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- Row level security for catering. Customers read their own; admins read
-- everything; staff read nothing directly (staff_catering_prep hands them
-- the confirmed requests at their counters). Nobody writes through the API:
-- the functions below are the only write paths.
-- ----------------------------------------------------------------------------
drop policy if exists catering_requests_insert_own on public.catering_requests;
drop policy if exists catering_requests_admin_write on public.catering_requests;
drop policy if exists catering_request_items_insert on public.catering_request_items;
drop policy if exists catering_request_items_admin_write on public.catering_request_items;

revoke insert, update, delete, truncate on public.catering_requests from anon, authenticated;
revoke insert, update, delete, truncate on public.catering_request_items from anon, authenticated;

alter table public.catering_quotes enable row level security;
alter table public.catering_quote_lines enable row level security;
alter table public.catering_messages enable row level security;
alter table public.catering_status_history enable row level security;

create policy catering_quotes_select on public.catering_quotes
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.catering_requests c where c.id = catering_quotes.catering_request_id and c.user_id = auth.uid())
  );

create policy catering_quote_lines_select on public.catering_quote_lines
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.catering_quotes q
        join public.catering_requests c on c.id = q.catering_request_id
       where q.id = catering_quote_lines.quote_id and c.user_id = auth.uid()
    )
  );

create policy catering_messages_select on public.catering_messages
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.catering_requests c where c.id = catering_messages.catering_request_id and c.user_id = auth.uid())
  );

create policy catering_status_history_select on public.catering_status_history
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.catering_requests c where c.id = catering_status_history.catering_request_id and c.user_id = auth.uid())
  );

revoke insert, update, delete, truncate on public.catering_quotes from anon, authenticated;
revoke insert, update, delete, truncate on public.catering_quote_lines from anon, authenticated;
revoke insert, update, delete, truncate on public.catering_messages from anon, authenticated;
revoke insert, update, delete, truncate on public.catering_status_history from anon, authenticated;

-- Customers no longer insert requests themselves (the server does, after
-- validating and rate limiting), so they no longer need a number.
revoke execute on function public.next_catering_number(timestamptz) from authenticated;

-- ----------------------------------------------------------------------------
-- Helpers.
-- ----------------------------------------------------------------------------
create or replace function public.catering_setting_int(p_key text, p_fallback integer)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((public.get_setting(p_key) #>> '{}')::integer, p_fallback);
$$;

revoke execute on function public.catering_setting_int(text, integer) from public, anon, authenticated;
grant execute on function public.catering_setting_int(text, integer) to service_role;

-- The caller is the request's owner (a signed-in, undeleted customer).
-- Raises the same 42501 for "not yours" and "does not exist", so ids cannot
-- be probed.
create or replace function public.catering_lock_own_request(p_request_id uuid)
returns public.catering_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests;
begin
  if auth.uid() is null or public.auth_role() is null then
    raise exception 'Sign in to manage catering requests' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.catering_requests where id = p_request_id for update;
  if not found or r.user_id is distinct from auth.uid() then
    raise exception 'Catering request not found' using errcode = 'insufficient_privilege';
  end if;
  return r;
end;
$$;

revoke execute on function public.catering_lock_own_request(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Creating a request: the server, after Zod validation, the delivery-area
-- check and the rate limit. The lead-time trigger still has the last word.
-- ----------------------------------------------------------------------------
create or replace function public.create_catering_request(p_user_id uuid, p_request jsonb, p_items jsonb)
returns table (request_id uuid, request_number text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  new_id uuid;
  new_number text;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    raise exception 'No open account %', p_user_id using errcode = 'insufficient_privilege';
  end if;

  insert into public.catering_requests (
    user_id, location_id, contact_name, contact_email, contact_phone, event_at, headcount,
    fulfillment, delivery_address, delivery_postal_code, budget_cents, notes, custom_drink_request,
    created_by, admin_attention_at
  )
  values (
    p_user_id,
    nullif(p_request ->> 'location_id', '')::uuid,
    p_request ->> 'contact_name',
    p_request ->> 'contact_email',
    nullif(p_request ->> 'contact_phone', ''),
    (p_request ->> 'event_at')::timestamptz,
    (p_request ->> 'headcount')::integer,
    (p_request ->> 'fulfillment')::public.fulfillment_type,
    nullif(p_request ->> 'delivery_address', ''),
    nullif(p_request ->> 'delivery_postal_code', ''),
    nullif(p_request ->> 'budget_cents', '')::integer,
    nullif(p_request ->> 'notes', ''),
    nullif(p_request ->> 'custom_drink_request', ''),
    p_user_id,
    now()
  )
  returning id, request_number into new_id, new_number;

  insert into public.catering_request_items (
    catering_request_id, product_id, product_size_id, product_name, size_name, quantity, notes
  )
  select new_id, item.product_id, item.product_size_id, item.product_name, item.size_name, item.quantity,
         nullif(item.notes, '')
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as item (
      product_id uuid, product_size_id uuid, product_name text, size_name text, quantity integer, notes text
    );

  return query select new_id, new_number;
end;
$$;

revoke execute on function public.create_catering_request(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_catering_request(uuid, jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Admin: issue a quote (or a revised one). Service role only, because the
-- totals are computed on the server by calculateCateringQuote; the server
-- has already checked the caller is an admin and names them in p_actor,
-- which is checked again here and recorded.
--
-- p_quote: items_subtotal_cents, discount_cents, discount_label,
--   delivery_fee_cents, delivery_fee_taxable, taxable_cents, tax_rate,
--   tax_cents, gratuity_percent, gratuity_cents, gratuity_taxable,
--   total_cents, expires_at, note_to_customer
-- p_lines: [{kind, product_id, product_size_id, description, size_name,
--   quantity, unit_price_cents, line_total_cents}]
-- ----------------------------------------------------------------------------
create or replace function public.catering_issue_quote(
  p_actor uuid,
  p_request_id uuid,
  p_quote jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests;
  next_version integer;
  new_id uuid;
  deadline timestamptz;
  expires timestamptz := (p_quote ->> 'expires_at')::timestamptz;
  line_sum integer;
  note text := nullif(trim(p_quote ->> 'note_to_customer'), '');
begin
  if p_actor is null or not exists (
    select 1 from public.profiles where id = p_actor and role = 'admin' and deleted_at is null
  ) then
    raise exception 'Only an admin can quote catering' using errcode = 'insufficient_privilege';
  end if;

  select * into r from public.catering_requests where id = p_request_id for update;
  if not found then
    raise exception 'Catering request not found' using errcode = 'no_data_found';
  end if;
  if r.status not in ('submitted', 'quoted') then
    raise exception 'A % request cannot be quoted', r.status using errcode = 'DC010';
  end if;

  deadline := r.event_at - make_interval(hours => public.catering_setting_int('catering.payment_deadline_hours', 48));
  if deadline <= now() then
    raise exception 'The payment deadline for this event has passed' using errcode = 'DC013';
  end if;
  if expires is null or expires <= now() or expires > deadline then
    raise exception 'The quote must expire after now and no later than the payment deadline (%)', deadline
      using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A quote needs at least one line' using errcode = 'invalid_parameter_value';
  end if;

  perform set_config('app.catering_actor', p_actor::text, true);

  -- The version it replaces stays, superseded.
  update public.catering_quotes
     set status = 'superseded', superseded_at = now(), superseded_reason = 'Replaced by a revised quote'
   where catering_request_id = r.id and status = 'active';

  select coalesce(max(version), 0) + 1 into next_version
    from public.catering_quotes where catering_request_id = r.id;

  insert into public.catering_quotes (
    catering_request_id, version, items_subtotal_cents, discount_cents, discount_label,
    delivery_fee_cents, delivery_fee_taxable, taxable_cents, tax_rate, tax_cents,
    gratuity_percent, gratuity_cents, gratuity_taxable, total_cents,
    expires_at, payment_deadline_at, note_to_customer, created_by
  )
  values (
    r.id, next_version,
    (p_quote ->> 'items_subtotal_cents')::integer,
    coalesce((p_quote ->> 'discount_cents')::integer, 0),
    nullif(trim(p_quote ->> 'discount_label'), ''),
    coalesce((p_quote ->> 'delivery_fee_cents')::integer, 0),
    coalesce((p_quote ->> 'delivery_fee_taxable')::boolean, true),
    (p_quote ->> 'taxable_cents')::integer,
    (p_quote ->> 'tax_rate')::numeric,
    (p_quote ->> 'tax_cents')::integer,
    nullif(p_quote ->> 'gratuity_percent', '')::numeric,
    coalesce((p_quote ->> 'gratuity_cents')::integer, 0),
    coalesce((p_quote ->> 'gratuity_taxable')::boolean, false),
    (p_quote ->> 'total_cents')::integer,
    expires, deadline, note, p_actor
  )
  returning id into new_id;

  insert into public.catering_quote_lines (
    quote_id, kind, product_id, product_size_id, description, size_name, quantity,
    unit_price_cents, line_total_cents, sort_order
  )
  select new_id, line.kind, line.product_id, line.product_size_id, line.description, nullif(line.size_name, ''),
         line.quantity, line.unit_price_cents, line.line_total_cents, (line.n - 1)::integer * 10
    from rows from (
      jsonb_to_recordset(p_lines) as (
        kind text, product_id uuid, product_size_id uuid, description text, size_name text,
        quantity integer, unit_price_cents integer, line_total_cents integer
      )
    ) with ordinality as line (kind, product_id, product_size_id, description, size_name, quantity, unit_price_cents, line_total_cents, n);

  if exists (select 1 from public.catering_quote_lines where quote_id = new_id and kind = 'product' and product_id is null) then
    raise exception 'A menu line must name its product' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(sum(line_total_cents), 0) into line_sum from public.catering_quote_lines where quote_id = new_id;
  if line_sum <> (p_quote ->> 'items_subtotal_cents')::integer then
    raise exception 'Quote lines add up to % but the quote says %', line_sum, p_quote ->> 'items_subtotal_cents'
      using errcode = 'check_violation';
  end if;

  if r.status = 'quoted' then
    -- Same status, so the trigger records nothing: note the revision here.
    insert into public.catering_status_history (catering_request_id, from_status, to_status, changed_by, reason)
    values (r.id, 'quoted', 'quoted', p_actor, format('Quote revised (version %s)', next_version));
  else
    perform set_config('app.catering_reason', format('Quote sent (version %s)', next_version), true);
  end if;

  update public.catering_requests
     set status = 'quoted',
         current_quote_id = new_id,
         admin_seen_at = now()
   where id = r.id;

  if note is not null then
    insert into public.catering_messages (catering_request_id, author_id, author_role, kind, body, quote_id)
    values (r.id, p_actor, 'admin', 'quote_note', left(note, 2000), new_id);
  end if;

  perform set_config('app.catering_actor', '', true);
  perform set_config('app.catering_reason', '', true);
  return new_id;
end;
$$;

revoke execute on function public.catering_issue_quote(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.catering_issue_quote(uuid, uuid, jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Customer: is this quote payable by me, now? Raises otherwise:
--   42501 not my request (or no such request)
--   DC010 the request is not waiting for payment
--   DC011 not the current quote (revised or sent back since)
--   DC012 the quote has expired
--   DC013 past the payment deadline
-- The pay page and the payment action call this as the customer; the
-- webhook checks again before confirming (mark_catering_paid).
-- ----------------------------------------------------------------------------
create or replace function public.catering_payable_quote(p_request_id uuid, p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests;
  q public.catering_quotes;
begin
  if auth.uid() is null or public.auth_role() is null then
    raise exception 'Sign in to pay' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.catering_requests where id = p_request_id;
  if not found or r.user_id is distinct from auth.uid() then
    raise exception 'Catering request not found' using errcode = 'insufficient_privilege';
  end if;
  if r.status <> 'quoted' then
    raise exception 'This request is not waiting for payment' using errcode = 'DC010';
  end if;
  select * into q from public.catering_quotes where id = p_quote_id and catering_request_id = r.id;
  if not found or q.status <> 'active' or r.current_quote_id is distinct from q.id then
    raise exception 'This is not the current quote' using errcode = 'DC011';
  end if;
  if now() >= q.payment_deadline_at then
    raise exception 'The payment deadline has passed' using errcode = 'DC013';
  end if;
  if now() >= q.expires_at then
    raise exception 'This quote has expired' using errcode = 'DC012';
  end if;

  return jsonb_build_object(
    'request_id', r.id,
    'request_number', r.request_number,
    'quote_id', q.id,
    'version', q.version,
    'total_cents', q.total_cents,
    'expires_at', q.expires_at,
    'payment_deadline_at', q.payment_deadline_at,
    'contact_email', r.contact_email
  );
end;
$$;

revoke execute on function public.catering_payable_quote(uuid, uuid) from public, anon;
grant execute on function public.catering_payable_quote(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Payment succeeded (webhook or reconcile). Under the request's row lock:
--   'confirmed'          the current, active quote paid in full: quote paid,
--                        request confirmed
--   'already_confirmed'  a replay
--   'not_payable'        the request was cancelled, or the quote revised or
--                        sent back, since the payment began: the caller
--                        refunds it in full
--   'too_late'           more than an hour past the payment deadline: the
--                        caller refunds it in full
--   'amount_mismatch'    recorded, flagged for an admin, not confirmed
--   'unknown_request'
-- The money is recorded in payments whatever the outcome.
-- ----------------------------------------------------------------------------
create or replace function public.mark_catering_paid(
  p_request_id uuid,
  p_quote_id uuid,
  p_payment_intent_id text,
  p_charge_id text,
  p_amount_cents integer,
  p_currency text,
  p_raw jsonb default null
)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests;
  q public.catering_quotes;
begin
  select * into r from public.catering_requests where id = p_request_id for update;
  if not found then
    return 'unknown_request';
  end if;

  update public.payments
     set status = case when status in ('refunded', 'partially_refunded') then status else 'succeeded' end,
         provider_charge_id = coalesce(nullif(p_charge_id, ''), provider_charge_id),
         failure_code = null,
         failure_message = null,
         raw = coalesce(p_raw, raw)
   where provider_payment_intent_id = p_payment_intent_id;

  if not found then
    insert into public.payments (catering_request_id, catering_quote_id, provider_payment_intent_id, provider_charge_id,
                                 status, amount_cents, tip_cents, raw)
    values (r.id, p_quote_id, p_payment_intent_id, nullif(p_charge_id, ''), 'succeeded', p_amount_cents, 0, p_raw);
  end if;

  if r.status in ('confirmed', 'fulfilled') and r.current_quote_id is not distinct from p_quote_id then
    return 'already_confirmed';
  end if;
  if r.status <> 'quoted' or r.current_quote_id is distinct from p_quote_id then
    return 'not_payable';
  end if;

  select * into q from public.catering_quotes where id = p_quote_id for update;
  if not found or q.status <> 'active' then
    return 'not_payable';
  end if;

  if p_amount_cents <> q.total_cents or lower(p_currency) <> 'usd' then
    update public.catering_requests
       set review_reason = format('Payment of %s %s did not match quote version %s (%s usd)',
                                  p_amount_cents, lower(p_currency), q.version, q.total_cents),
           flagged_for_review_at = now(),
           admin_attention_at = now()
     where id = r.id;
    return 'amount_mismatch';
  end if;

  -- A payment started before the deadline may land a little after it.
  if now() > q.payment_deadline_at + interval '1 hour' then
    return 'too_late';
  end if;

  update public.catering_quotes set status = 'paid' where id = q.id;
  perform set_config('app.catering_reason', format('Paid (quote version %s)', q.version), true);
  update public.catering_requests
     set status = 'confirmed', admin_attention_at = now()
   where id = r.id;
  perform set_config('app.catering_reason', '', true);
  return 'confirmed';
end;
$$;

revoke execute on function public.mark_catering_paid(uuid, uuid, text, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.mark_catering_paid(uuid, uuid, text, text, integer, text, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Customer: ask for changes to the quote. The quote goes back (superseded,
-- kept in history) and the request returns to submitted for a revised quote.
-- ----------------------------------------------------------------------------
create or replace function public.catering_request_changes(p_request_id uuid, p_message text)
returns public.catering_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests := public.catering_lock_own_request(p_request_id);
  body text := nullif(trim(p_message), '');
begin
  if body is null or char_length(body) < 3 then
    raise exception 'Tell us what you would like changed' using errcode = 'invalid_parameter_value';
  end if;
  if r.status <> 'quoted' then
    raise exception 'Changes can be asked for only while a quote is waiting' using errcode = 'DC010';
  end if;

  update public.catering_quotes
     set status = 'superseded', superseded_at = now(), superseded_reason = 'Customer asked for changes'
   where id = r.current_quote_id and status = 'active';

  insert into public.catering_messages (catering_request_id, author_id, author_role, kind, body, quote_id)
  values (r.id, auth.uid(), 'customer', 'change_request', left(body, 2000), r.current_quote_id);

  perform set_config('app.catering_reason', 'Customer asked for changes', true);
  update public.catering_requests
     set status = 'submitted', current_quote_id = null, admin_attention_at = now()
   where id = r.id
  returning * into r;
  perform set_config('app.catering_reason', '', true);
  return r;
end;
$$;

revoke execute on function public.catering_request_changes(uuid, text) from public, anon;
grant execute on function public.catering_request_changes(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Customer: cancel, free of charge, before paying. After paying (confirmed)
-- this refuses with DC015: ask for a cancellation instead.
-- ----------------------------------------------------------------------------
create or replace function public.catering_cancel(p_request_id uuid, p_reason text default null)
returns public.catering_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests := public.catering_lock_own_request(p_request_id);
  reason text := left(coalesce(nullif(trim(p_reason), ''), 'No reason given'), 500);
begin
  if r.status = 'confirmed' then
    raise exception 'This request has been paid for; ask us to cancel it' using errcode = 'DC015';
  end if;
  if r.status not in ('submitted', 'quoted') then
    raise exception 'A % request cannot be cancelled', r.status using errcode = 'DC010';
  end if;

  update public.catering_quotes
     set status = 'void', superseded_at = now(), superseded_reason = 'Request cancelled'
   where catering_request_id = r.id and status = 'active';

  update public.catering_requests
     set status = 'cancelled', cancellation_reason = 'Cancelled by the customer: ' || reason,
         admin_attention_at = now()
   where id = r.id
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.catering_cancel(uuid, text) from public, anon;
grant execute on function public.catering_cancel(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Customer: ask for a paid request to be cancelled. Only an admin can then
-- cancel it, with a full or partial refund.
-- ----------------------------------------------------------------------------
create or replace function public.catering_request_cancellation(p_request_id uuid, p_reason text)
returns public.catering_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests := public.catering_lock_own_request(p_request_id);
  reason text := nullif(trim(p_reason), '');
begin
  if reason is null or char_length(reason) < 3 then
    raise exception 'Tell us why you need to cancel' using errcode = 'invalid_parameter_value';
  end if;
  if r.status <> 'confirmed' then
    raise exception 'Only a paid request needs a cancellation request' using errcode = 'DC010';
  end if;
  if r.cancellation_requested_at is not null then
    raise exception 'You have already asked us to cancel this request' using errcode = 'DC014';
  end if;

  insert into public.catering_messages (catering_request_id, author_id, author_role, kind, body)
  values (r.id, auth.uid(), 'customer', 'cancellation_request', left(reason, 2000));

  update public.catering_requests
     set cancellation_requested_at = now(),
         cancellation_request_reason = left(reason, 1000),
         admin_attention_at = now()
   where id = r.id
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.catering_request_cancellation(uuid, text) from public, anon;
grant execute on function public.catering_request_cancellation(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Admin: cancel a request that holds no money (submitted or quoted). A paid
-- one is refused (DC015): it goes through catering_cancel_for_refund on the
-- server, which then refunds.
-- ----------------------------------------------------------------------------
create or replace function public.admin_catering_cancel(p_request_id uuid, p_reason text)
returns public.catering_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests;
  reason text := nullif(trim(p_reason), '');
begin
  if not public.is_admin() then
    raise exception 'Only an admin can do that' using errcode = 'insufficient_privilege';
  end if;
  if reason is null or char_length(reason) < 3 then
    raise exception 'A reason is required to cancel' using errcode = 'invalid_parameter_value';
  end if;
  select * into r from public.catering_requests where id = p_request_id for update;
  if not found then
    raise exception 'Catering request not found' using errcode = 'no_data_found';
  end if;
  if r.status = 'confirmed' then
    raise exception 'This request has been paid for; cancel it with a refund' using errcode = 'DC015';
  end if;
  if r.status not in ('submitted', 'quoted') then
    raise exception 'A % request cannot be cancelled', r.status using errcode = 'DC010';
  end if;

  update public.catering_quotes
     set status = 'void', superseded_at = now(), superseded_reason = 'Request cancelled'
   where catering_request_id = r.id and status = 'active';

  update public.catering_requests
     set status = 'cancelled', cancellation_reason = left(reason, 500), admin_seen_at = now()
   where id = r.id
  returning * into r;
  return r;
end;
$$;

revoke execute on function public.admin_catering_cancel(uuid, text) from public, anon;
grant execute on function public.admin_catering_cancel(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Admin (server): cancel a request that may hold money, before refunding it.
-- Service role, with the admin named and re-checked under the row lock.
-- Returns 'cancelled' | 'not_found' | 'forbidden' | 'reason_required' |
-- 'not_cancellable'.
-- ----------------------------------------------------------------------------
create or replace function public.catering_cancel_for_refund(p_actor uuid, p_request_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests;
  reason text := nullif(trim(p_reason), '');
begin
  if p_actor is null or not exists (
    select 1 from public.profiles where id = p_actor and role = 'admin' and deleted_at is null
  ) then
    return 'forbidden';
  end if;
  if reason is null or char_length(reason) < 3 then
    return 'reason_required';
  end if;
  select * into r from public.catering_requests where id = p_request_id for update;
  if not found then
    return 'not_found';
  end if;
  if r.status not in ('submitted', 'quoted', 'confirmed') then
    return 'not_cancellable';
  end if;

  perform set_config('app.catering_actor', p_actor::text, true);
  update public.catering_quotes
     set status = 'void', superseded_at = now(), superseded_reason = 'Request cancelled'
   where catering_request_id = r.id and status = 'active';
  update public.catering_requests
     set status = 'cancelled', cancellation_reason = left(reason, 500), admin_seen_at = now()
   where id = r.id;
  perform set_config('app.catering_actor', '', true);
  return 'cancelled';
end;
$$;

revoke execute on function public.catering_cancel_for_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.catering_cancel_for_refund(uuid, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- Admin or staff at the request's counter: mark a confirmed request
-- fulfilled, once its event day (Honolulu) has arrived.
-- ----------------------------------------------------------------------------
create or replace function public.catering_mark_fulfilled(p_request_id uuid)
returns public.catering_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.catering_requests;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'Only staff can do that' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.catering_requests where id = p_request_id for update;
  if not found or not public.can_access_location(r.location_id) then
    raise exception 'Catering request not found' using errcode = 'insufficient_privilege';
  end if;
  if r.status = 'fulfilled' then
    return r;
  end if;
  if r.status <> 'confirmed' then
    raise exception 'Only a confirmed request can be fulfilled' using errcode = 'DC010';
  end if;
  if public.cafe_date(r.event_at) > public.cafe_today() then
    raise exception 'This event has not happened yet' using errcode = 'DC016';
  end if;

  update public.catering_requests set status = 'fulfilled' where id = r.id returning * into r;
  return r;
end;
$$;

revoke execute on function public.catering_mark_fulfilled(uuid) from public, anon;
grant execute on function public.catering_mark_fulfilled(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Admin: the inbox's "new" marker is cleared by opening the request.
-- ----------------------------------------------------------------------------
create or replace function public.admin_catering_mark_seen(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can do that' using errcode = 'insufficient_privilege';
  end if;
  update public.catering_requests set admin_seen_at = now() where id = p_request_id;
end;
$$;

revoke execute on function public.admin_catering_mark_seen(uuid) from public, anon;
grant execute on function public.admin_catering_mark_seen(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- Refunds: apply_refund_state learns catering. A full refund of the payment
-- for a confirmed request's quote cancels the request (a refund made in the
-- Stripe dashboard, say); a refund of a stray payment (a quote revised while
-- the customer was paying) changes nothing else.
-- ----------------------------------------------------------------------------
create or replace function public.apply_refund_state(
  p_payment_intent_id text,
  p_refunded_cents integer,
  p_reason text default null
)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  pay public.payments;
  o public.orders;
  r public.catering_requests;
begin
  select * into pay from public.payments where provider_payment_intent_id = p_payment_intent_id for update;
  if not found then
    return null;
  end if;

  update public.payments
     set refunded_cents = least(amount_cents, greatest(refunded_cents, p_refunded_cents)),
         status = case
           when least(amount_cents, greatest(refunded_cents, p_refunded_cents)) >= amount_cents then 'refunded'
           when greatest(refunded_cents, p_refunded_cents) > 0 then 'partially_refunded'
           else status
         end
   where id = pay.id
  returning * into pay;

  if pay.catering_request_id is not null then
    select * into r from public.catering_requests where id = pay.catering_request_id for update;
    if pay.refunded_cents >= pay.amount_cents and pay.amount_cents > 0
       and r.status = 'confirmed' and pay.catering_quote_id is not distinct from r.current_quote_id then
      update public.catering_requests
         set status = 'cancelled',
             cancellation_reason = coalesce(r.cancellation_reason, p_reason, 'Payment refunded')
       where id = r.id;
      r.status := 'cancelled';
    end if;
    return r.status::text;
  end if;

  select * into o from public.orders where id = pay.order_id for update;

  if pay.refunded_cents >= pay.amount_cents and pay.amount_cents > 0 then
    if o.status in ('pending_payment', 'placed', 'accepted', 'preparing', 'ready') then
      update public.orders
         set status = 'cancelled',
             cancellation_reason = coalesce(o.cancellation_reason, p_reason, 'Payment refunded')
       where id = o.id;
      o.status := 'cancelled';
    end if;
    if o.status in ('cancelled', 'picked_up') then
      update public.orders set status = 'refunded' where id = o.id;
      o.status := 'refunded';
    end if;
  end if;

  return o.status::text;
end;
$$;

revoke execute on function public.apply_refund_state(text, integer, text) from public, anon, authenticated;
grant execute on function public.apply_refund_state(text, integer, text) to service_role;

-- ----------------------------------------------------------------------------
-- Emails. The outbox now carries catering emails too: to the customer
-- (received, quote ready, paid, reminder, cancelled) and to the admin
-- address in catering.admin_notification_email (new request, changes asked
-- for, paid, cancellation asked for). Written in the same transaction as
-- the change that owes them, like order emails.
-- ----------------------------------------------------------------------------
alter table public.email_outbox
  add column catering_request_id uuid references public.catering_requests (id) on delete cascade,
  add column catering_quote_id uuid references public.catering_quotes (id) on delete cascade,
  add column catering_message_id uuid references public.catering_messages (id) on delete cascade,
  drop constraint email_outbox_kind_check,
  add constraint email_outbox_kind_check check (kind in (
    'order_receipt', 'order_cancelled', 'order_refunded', 'order_ready',
    'catering_received', 'catering_quote_ready', 'catering_confirmed', 'catering_reminder', 'catering_cancelled',
    'catering_admin_new', 'catering_admin_change_request', 'catering_admin_paid', 'catering_admin_cancellation_request'
  )),
  add constraint email_outbox_one_subject check ((order_id is null) <> (catering_request_id is null));

create index email_outbox_catering_idx on public.email_outbox (catering_request_id) where catering_request_id is not null;

create or replace function public.enqueue_catering_request_emails()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.email_outbox (kind, catering_request_id, dedupe_key) values
      ('catering_received', new.id, 'catering_received:' || new.id),
      ('catering_admin_new', new.id, 'catering_admin_new:' || new.id)
    on conflict (dedupe_key) do nothing;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'confirmed' then
    insert into public.email_outbox (kind, catering_request_id, catering_quote_id, dedupe_key) values
      ('catering_confirmed', new.id, new.current_quote_id, 'catering_confirmed:' || new.id),
      ('catering_admin_paid', new.id, new.current_quote_id, 'catering_admin_paid:' || new.id)
    on conflict (dedupe_key) do nothing;
  elsif new.status = 'cancelled' then
    insert into public.email_outbox (kind, catering_request_id, dedupe_key)
    values ('catering_cancelled', new.id, 'catering_cancelled:' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger catering_requests_enqueue_emails
  after insert or update of status on public.catering_requests
  for each row execute function public.enqueue_catering_request_emails();

create or replace function public.enqueue_catering_quote_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.email_outbox (kind, catering_request_id, catering_quote_id, dedupe_key)
  values ('catering_quote_ready', new.catering_request_id, new.id, 'catering_quote_ready:' || new.id)
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;

create trigger catering_quotes_enqueue_email
  after insert on public.catering_quotes
  for each row execute function public.enqueue_catering_quote_email();

create or replace function public.enqueue_catering_message_email()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  email_kind text := case new.kind
    when 'change_request' then 'catering_admin_change_request'
    when 'cancellation_request' then 'catering_admin_cancellation_request'
  end;
begin
  if email_kind is not null then
    insert into public.email_outbox (kind, catering_request_id, catering_message_id, dedupe_key)
    values (email_kind, new.catering_request_id, new.id, email_kind || ':' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

create trigger catering_messages_enqueue_email
  after insert on public.catering_messages
  for each row execute function public.enqueue_catering_message_email();

-- Reminders before confirmed events. Called by the outbox sender before
-- each sweep, so no separate schedule is needed. One per request.
create or replace function public.enqueue_catering_reminders()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  if public.get_setting('catering.reminder_enabled') is distinct from 'true'::jsonb then
    return 0;
  end if;

  insert into public.email_outbox (kind, catering_request_id, dedupe_key)
  select 'catering_reminder', c.id, 'catering_reminder:' || c.id
    from public.catering_requests c
   where c.status = 'confirmed'
     and c.event_at > now()
     and c.event_at <= now() + make_interval(hours => public.catering_setting_int('catering.reminder_hours_before', 24))
  on conflict (dedupe_key) do nothing;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.enqueue_catering_reminders() from public, anon, authenticated;
grant execute on function public.enqueue_catering_reminders() to service_role;

-- ----------------------------------------------------------------------------
-- The staff prep list: the paid quote's lines (what was sold), falling back
-- to what the customer asked for when there is no quote line to show.
-- ----------------------------------------------------------------------------
drop function if exists public.staff_catering_prep(uuid, date);

create or replace function public.staff_catering_prep(
  p_location_id uuid,
  p_day date default null
)
returns table (
  id                   uuid,
  request_number       text,
  status               public.catering_status,
  event_at             timestamptz,
  headcount            integer,
  fulfillment          public.fulfillment_type,
  delivery_address     text,
  contact_name         text,
  contact_phone        text,
  notes                text,
  custom_drink_request text,
  items                jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.request_number, c.status, c.event_at, c.headcount, c.fulfillment, c.delivery_address,
    c.contact_name, c.contact_phone, c.notes, c.custom_drink_request,
    coalesce(
      (
        select jsonb_agg(
                 jsonb_build_object('name', l.description, 'size', l.size_name, 'quantity', l.quantity, 'notes', null)
                 order by l.sort_order, l.id)
          from public.catering_quote_lines l
         where l.quote_id = c.current_quote_id
      ),
      (
        select jsonb_agg(
                 jsonb_build_object('name', i.product_name, 'size', i.size_name, 'quantity', i.quantity, 'notes', i.notes)
                 order by i.created_at, i.id)
          from public.catering_request_items i
         where i.catering_request_id = c.id
      ),
      '[]'::jsonb
    )
  from public.catering_requests c
  where public.can_access_location(p_location_id)
    and c.location_id = p_location_id
    and c.status in ('confirmed', 'fulfilled')
    and public.cafe_date(c.event_at) = coalesce(p_day, public.cafe_today())
  order by c.event_at;
$$;

revoke execute on function public.staff_catering_prep(uuid, date) from public, anon;
grant execute on function public.staff_catering_prep(uuid, date) to authenticated, service_role;

comment on function public.staff_catering_prep is
  'Confirmed (and fulfilled) catering for one location on one Honolulu date (default today), with the paid quote''s lines: the staff prep list.';

-- ----------------------------------------------------------------------------
-- Account deletion: as before, plus catering payments' stored payloads, the
-- delivery ZIP and the customer's catering messages.
-- ----------------------------------------------------------------------------
create or replace function public.delete_account_data(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role public.user_role;
  closing_reason constant text := 'Customer closed their account';
begin
  select role into target_role
    from public.profiles
   where id = target_user_id
     and deleted_at is null
     for update;

  if not found then
    raise exception 'No open account with id %', target_user_id
      using errcode = 'no_data_found';
  end if;

  if target_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext('public.delete_account_data/last_admin'));

    if not exists (
      select 1
        from public.profiles
       where role = 'admin'
         and deleted_at is null
         and id <> target_user_id
    ) then
      raise exception 'The last remaining admin cannot delete their own account'
        using errcode = 'DC001';
    end if;
  end if;

  -- 1. Cancel what is still in flight (held points are released here).
  update public.orders
     set status = 'cancelled',
         cancellation_reason = closing_reason
   where user_id = target_user_id
     and status in ('pending_payment', 'placed', 'accepted', 'preparing', 'ready');

  update public.catering_quotes q
     set status = 'void', superseded_at = now(), superseded_reason = closing_reason
    from public.catering_requests c
   where q.catering_request_id = c.id
     and c.user_id = target_user_id
     and q.status = 'active';

  update public.catering_requests
     set status = 'cancelled',
         cancellation_reason = closing_reason
   where user_id = target_user_id
     and status in ('submitted', 'quoted', 'confirmed');

  -- 2. Keep the records, lose the person.
  update public.payments p
     set provider_customer_id = null,
         raw = null
    from public.orders o
   where p.order_id = o.id
     and o.user_id = target_user_id;

  update public.payments p
     set provider_customer_id = null,
         raw = null
    from public.catering_requests c
   where p.catering_request_id = c.id
     and c.user_id = target_user_id;

  update public.orders
     set user_id = null,
         customer_first_name = null,
         customer_phone = null,
         customer_email = null,
         notes = null,
         anonymized_at = now()
   where user_id = target_user_id;

  update public.catering_messages m
     set body = '[removed]'
    from public.catering_requests c
   where m.catering_request_id = c.id
     and c.user_id = target_user_id
     and m.author_role = 'customer';

  update public.catering_requests
     set user_id = null,
         contact_name = null,
         contact_email = null,
         contact_phone = null,
         delivery_address = null,
         delivery_postal_code = null,
         notes = null,
         custom_drink_request = null,
         cancellation_request_reason = null,
         anonymized_at = now()
   where user_id = target_user_id;

  update public.promo_redemptions
     set user_id = null
   where user_id = target_user_id;

  -- 3. Nothing here is needed for reporting.
  delete from public.favorites where user_id = target_user_id;
  delete from public.loyalty_transactions where user_id = target_user_id;
  delete from public.loyalty_reservations where user_id = target_user_id;
  delete from public.staff_locations where profile_id = target_user_id;

  -- 4. Tombstone. Every signed-in check treats deleted_at as signed out.
  update public.profiles
     set email = null,
         full_name = null,
         first_name = null,
         phone = null,
         marketing_opt_in = false,
         sms_opt_in = false,
         deleted_at = now()
   where id = target_user_id;
end;
$$;

revoke execute on function public.delete_account_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid) to service_role;

comment on table public.catering_quotes is
  'Versioned catering quotes. Immutable once issued; one active per request; earlier versions kept.';
comment on function public.catering_issue_quote is
  'Admin quote (or revision) with server-computed totals. Service role, admin named in p_actor.';
comment on function public.mark_catering_paid is
  'Webhook/reconcile: records a catering payment and confirms the request, or says why not. Service role only.';

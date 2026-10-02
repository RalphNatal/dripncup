-- ============================================================================
-- Phase 5: order tracking, emails, history and favourites.
--
--   payments.method_*      card brand, last four and wallet, for the receipt
--   notification_prefs     the "order ready" email is now opt-in
--   favorites              40-character names, unique per customer ignoring
--                          case, at most 50 each
--   email_outbox           emails owed to customers, written in the same
--                          transaction as the status change that owes them
--   list_my_orders()       the order history and active-order lists
-- ============================================================================

-- ----------------------------------------------------------------------------
-- How an order was paid, as the receipt shows it ("Visa •••• 4242", "Apple
-- Pay"). Copied from the provider by the payment webhook; never card data
-- beyond the brand and last four, which Stripe itself shows on receipts.
-- ----------------------------------------------------------------------------
alter table public.payments
  add column method_brand  text,
  add column method_last4  text check (method_last4 is null or method_last4 ~ '^[0-9]{4}$'),
  add column method_wallet text;

-- ----------------------------------------------------------------------------
-- The "your order is ready" email is off unless the customer turns it on: the
-- in-app alert covers it. Receipts and refunds are transactional and always
-- sent. No customer has chosen yet (pre-launch), so existing rows follow.
-- ----------------------------------------------------------------------------
alter table public.profiles
  alter column notification_prefs set default '{"order_ready_push": true, "order_ready_email": false}'::jsonb;

update public.profiles
   set notification_prefs = notification_prefs || '{"order_ready_email": false}'::jsonb;

-- ----------------------------------------------------------------------------
-- Favourites.
-- ----------------------------------------------------------------------------
alter table public.favorites drop constraint if exists favorites_name_check;
alter table public.favorites
  add constraint favorites_name_check check (char_length(name) between 1 and 40 and btrim(name) <> '');

-- "My usual" and "my usual" are the same favourite.
alter table public.favorites drop constraint if exists favorites_user_id_name_key;
create unique index favorites_user_name_idx on public.favorites (user_id, lower(name));

alter table public.favorites
  -- Shown when the size has since been removed ("Large is no longer offered").
  add column size_name text,
  add constraint favorites_modifiers_shape check (
    jsonb_typeof(modifiers) = 'array' and jsonb_array_length(modifiers) <= 40
  );

-- At most 50 per customer. The advisory lock makes the count exact when two
-- saves race.
create or replace function public.enforce_favorites_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.favorites/' || new.user_id::text));
  if (select count(*) from public.favorites where user_id = new.user_id) >= 50 then
    raise exception 'A customer can save up to 50 favorites' using errcode = 'DC003';
  end if;
  return new;
end;
$$;

create trigger favorites_enforce_limit
  before insert on public.favorites
  for each row execute function public.enforce_favorites_limit();

-- ----------------------------------------------------------------------------
-- Email outbox.
--
-- A trigger on orders writes a row when a status change owes the customer an
-- email, inside the same transaction as the change. A sender
-- (src/lib/email/outbox.ts) delivers rows afterwards. So:
--   * the payment webhook never fails because an email provider is down
--   * a replayed webhook never sends a second receipt: replays do not change
--     the status, and `dedupe_key` is unique per order and kind
--   * a failed send is retried with backoff, and gives up as `failed` (shown
--     to admins in Phase 9)
--
-- The recipient is looked up when the email is sent, not stored here, so an
-- account deleted in the meantime gets nothing (`skipped`).
-- ----------------------------------------------------------------------------
create table public.email_outbox (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null
                      check (kind in ('order_receipt', 'order_cancelled', 'order_refunded', 'order_ready')),
  order_id            uuid references public.orders (id) on delete cascade,
  -- kind:order_id. A second insert for the same email is a no-op.
  dedupe_key          text not null unique,
  status              text not null default 'pending'
                      check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts            integer not null default 0 check (attempts >= 0),
  max_attempts        integer not null default 6 check (max_attempts >= 1),
  next_attempt_at     timestamptz not null default now(),
  locked_at           timestamptz,
  last_error          text,
  provider            text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- What the sender picks up next.
create index email_outbox_due_idx on public.email_outbox (next_attempt_at)
  where status in ('pending', 'sending');
-- The admin "failed emails" list (Phase 9).
create index email_outbox_failed_idx on public.email_outbox (created_at) where status = 'failed';
create index email_outbox_order_idx on public.email_outbox (order_id);

create trigger email_outbox_set_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

alter table public.email_outbox enable row level security;

-- Admins can see the outbox (Phase 9); only the server writes it.
create policy email_outbox_admin_read on public.email_outbox
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete, truncate on public.email_outbox from anon, authenticated;

comment on table public.email_outbox is
  'Customer emails owed by order status changes. Written by trigger, delivered by the server-side sender.';

-- Which email, if any, a status change owes.
--   placed                          receipt
--   cancelled, after money was taken cancellation (with the refund)
--   picked_up -> refunded           refund
--   ready                           only if the customer opted in
-- An unpaid checkout that expires owes nothing: the customer never got a
-- receipt. cancelled -> refunded owes nothing more: the cancellation email
-- already carries the refund.
create or replace function public.enqueue_order_emails()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  email_kind text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'placed' then
    email_kind := 'order_receipt';
  elsif new.status = 'cancelled'
    and (
      old.status in ('placed', 'accepted', 'preparing', 'ready')
      or exists (
        select 1 from public.payments p
         where p.order_id = new.id and p.status in ('succeeded', 'partially_refunded', 'refunded')
      )
    ) then
    email_kind := 'order_cancelled';
  elsif new.status = 'refunded' and old.status = 'picked_up' then
    email_kind := 'order_refunded';
  elsif new.status = 'ready'
    -- A comparison, not a cast: a malformed preference must never be able to
    -- block a status change.
    and exists (
      select 1 from public.profiles pr
       where pr.id = new.user_id and pr.notification_prefs -> 'order_ready_email' = 'true'::jsonb
    ) then
    email_kind := 'order_ready';
  end if;

  if email_kind is not null then
    insert into public.email_outbox (kind, order_id, dedupe_key)
    values (email_kind, new.id, email_kind || ':' || new.id)
    on conflict (dedupe_key) do nothing;
  end if;

  return new;
end;
$$;

create trigger orders_enqueue_emails
  after update of status on public.orders
  for each row execute function public.enqueue_order_emails();

-- Hands the sender up to p_limit due rows, marked `sending` so a concurrent
-- sender skips them. A `sending` row older than five minutes belongs to a
-- sender that died and is handed out again.
create or replace function public.claim_email_outbox(p_limit integer default 10)
returns setof public.email_outbox
language sql
set search_path = public, pg_temp
as $$
  update public.email_outbox e
     set status = 'sending', locked_at = now(), attempts = e.attempts + 1
   where e.id in (
     select id from public.email_outbox
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and locked_at < now() - interval '5 minutes')
      order by next_attempt_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked
   )
  returning e.*;
$$;

revoke execute on function public.claim_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;

-- ----------------------------------------------------------------------------
-- The signed-in customer's orders, newest first.
--   p_scope 'active'  placed through ready
--   p_scope 'past'    picked up, cancelled or refunded -- but only orders that
--                     were paid for: an abandoned checkout is not history
-- Keyset pagination on (created_at, id): pass the last row's pair to get the
-- next page.
--
-- SECURITY DEFINER so a past pop-up whose location is now inactive (hidden
-- from customers by RLS) still shows its name. The auth.uid() filter is the
-- access check.
-- ----------------------------------------------------------------------------
create or replace function public.list_my_orders(
  p_scope text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 10
)
returns table (
  id                 uuid,
  order_number       text,
  status             public.order_status,
  created_at         timestamptz,
  placed_at          timestamptz,
  ready_at           timestamptz,
  pickup_type        public.pickup_type,
  scheduled_for      timestamptz,
  estimated_ready_at timestamptz,
  location_id        uuid,
  location_name      text,
  total_cents        integer,
  items              jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    o.id, o.order_number, o.status, o.created_at, o.placed_at, o.ready_at,
    o.pickup_type, o.scheduled_for, o.estimated_ready_at,
    o.location_id, l.name, o.total_cents,
    coalesce((
      select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity) order by i.created_at, i.id)
        from public.order_items i
       where i.order_id = o.id
    ), '[]'::jsonb)
  from public.orders o
  join public.locations l on l.id = o.location_id
  where auth.uid() is not null
    and o.user_id = auth.uid()
    and case p_scope
      when 'active' then o.status in ('placed', 'accepted', 'preparing', 'ready')
      when 'past' then
        o.status in ('picked_up', 'cancelled', 'refunded')
        and (
          o.placed_at is not null
          or exists (
            select 1 from public.payments p
             where p.order_id = o.id and p.status in ('succeeded', 'partially_refunded', 'refunded')
          )
        )
      else false
    end
    and (
      p_before_created_at is null
      or (o.created_at, o.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by o.created_at desc, o.id desc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

revoke execute on function public.list_my_orders(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_my_orders(text, timestamptz, uuid, integer) to authenticated, service_role;

comment on function public.list_my_orders is
  'The calling customer''s active or past orders, newest first, keyset-paginated.';

-- ============================================================================
-- Phase 4: checkout, payments, refunds, webhooks and rate limiting.
--
-- Everything here is written by server code holding the service role. The
-- multi-step writes are SQL functions so each runs in one transaction:
--   create_checkout_order  order + snapshot lines, idempotent on the key
--   mark_order_paid        webhook: payment recorded, order placed, promo
--                          redemption counted -- or rejected / flagged
--   record_payment_failure webhook: a failed attempt, order left to retry
--   apply_refund_state     webhook / refunds: amounts and order status
--   rate_limit_hit         fixed-window counter for abuse limits
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Settings for pickup timing, capacity, expiry and custom tips.
-- ----------------------------------------------------------------------------
insert into public.settings (key, value, description, is_public) values
  ('orders.queue_minutes_per_order', '2'::jsonb,
   'ASAP estimate: minutes added to the prep time for each order already in the queue.', true),
  ('orders.last_slot_buffer_minutes', '15'::jsonb,
   'The last scheduled pickup slot starts at least this many minutes before closing.', true),
  ('orders.max_orders_per_slot', '8'::jsonb,
   'Most scheduled orders per 15-minute slot; a full slot is shown as unavailable. 0 = no limit.', true),
  ('orders.pending_expiry_minutes', '30'::jsonb,
   'Unpaid checkouts older than this are cancelled by the expiry job.', false),
  ('tip.custom_max_cents', '10000'::jsonb,
   'Upper limit for a custom tip, in cents, to catch typos.', true),
  ('tip.custom_max_percent', '100'::jsonb,
   'A custom tip may not exceed this percentage of the subtotal.', true)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Orders and payments: a few more columns.
-- ----------------------------------------------------------------------------
alter table public.orders
  -- Hash of what was checked out (lines, pickup, promo, tip, notes). The same
  -- idempotency key with a different fingerprint is refused, so a reused key
  -- can never charge for a cart the customer has since changed.
  add column checkout_fingerprint text,
  -- Set when a payment did not match the order (amount or currency). The
  -- order is not placed, and the expiry job leaves it alone for an admin.
  add column review_reason text,
  add column flagged_for_review_at timestamptz;

-- Finds stale unpaid checkouts for the expiry job.
create index orders_pending_created_idx on public.orders (created_at)
  where status = 'pending_payment';
-- Counts bookings per scheduled pickup slot.
create index orders_scheduled_slot_idx on public.orders (location_id, scheduled_for)
  where pickup_type = 'scheduled';

alter table public.payments
  add column failure_code text,
  add column failure_message text;

-- ----------------------------------------------------------------------------
-- Refunds. One row per refund attempt, whoever started it (staff, account
-- deletion, the webhook's auto-refund, or the Stripe dashboard). A failed
-- refund stays here for an admin to see and retry (admin UI: Phase 9).
-- ----------------------------------------------------------------------------
create table public.refunds (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  payment_id         uuid references public.payments (id) on delete set null,
  provider           text not null default 'stripe',
  provider_refund_id text unique,
  amount_cents       integer not null check (amount_cents > 0),
  reason             text not null,
  status             text not null default 'pending'
                     check (status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  failure_reason     text,
  requested_by       uuid references public.profiles (id) on delete set null,
  attempts           integer not null default 1 check (attempts >= 1),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index refunds_order_idx on public.refunds (order_id);
-- The admin retry list.
create index refunds_failed_idx on public.refunds (created_at) where status = 'failed';

create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();

alter table public.refunds enable row level security;

-- Customers see refunds on their own orders (for the receipt); admins see all.
-- Nothing client-side ever writes here.
create policy refunds_select on public.refunds
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.orders o where o.id = refunds.order_id and o.user_id = auth.uid())
  );

comment on table public.refunds is
  'Every refund attempt and its outcome. Failed rows are the admin retry queue.';

-- ----------------------------------------------------------------------------
-- Payment-provider webhook events we have seen. The primary key is the
-- provider's event id, so a replayed or duplicated delivery is recognised and
-- skipped. `processing` rows that never finish are retried on redelivery.
-- ----------------------------------------------------------------------------
create table public.webhook_events (
  id           text primary key,
  provider     text not null default 'stripe',
  type         text not null,
  status       text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  attempts     integer not null default 1,
  last_error   text,
  received_at  timestamptz not null default now(),
  -- When the current (or last) attempt started; a fresh 'processing' row
  -- means another delivery is handling the event right now.
  attempted_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.webhook_events enable row level security;
-- No policies: service role only.

comment on table public.webhook_events is 'Dedupe log for payment webhooks. Service role only.';

-- ----------------------------------------------------------------------------
-- Rate limiting: a fixed-window counter per key ("checkout:user:<id>",
-- "promo:ip:<addr>"). See ARCHITECTURE.md for why Postgres and not Redis.
-- ----------------------------------------------------------------------------
create table public.rate_limit_hits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

create index rate_limit_hits_window_idx on public.rate_limit_hits (window_start);

alter table public.rate_limit_hits enable row level security;
-- No policies: service role only.

-- Adds `p_cost` hits against `p_key` and returns true while the window's total
-- is within `p_limit` per `p_window_seconds`. Atomic under concurrency.
-- `p_cost = 0` only looks: used to refuse a promo attempt from someone who is
-- already over their failure limit, without counting the look.
create or replace function public.rate_limit_hit(
  p_key text,
  p_limit integer,
  p_window_seconds integer,
  p_cost integer default 1
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  window_begins timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  current_hits integer;
begin
  insert into public.rate_limit_hits (key, window_start, hits)
  values (p_key, window_begins, p_cost)
  on conflict (key, window_start)
  do update set hits = rate_limit_hits.hits + p_cost
  returning hits into current_hits;

  -- Old windows are useless; sweep them now and then instead of on a cron.
  if random() < 0.02 then
    delete from public.rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return current_hits <= p_limit;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer, integer) to service_role;

-- ----------------------------------------------------------------------------
-- Promo lookup for checkout. Codes match case-insensitively (the unique index
-- is on upper(code)); `user_uses` counts this customer's paid redemptions
-- plus their other unpaid checkouts using it, so opening several checkouts at
-- once cannot slip past a per-customer limit.
-- ----------------------------------------------------------------------------
create or replace function public.get_promo_for_checkout(
  p_code text,
  p_user_id uuid,
  p_exclude_idempotency_key text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(p) || jsonb_build_object(
    'user_uses',
    (select count(*) from public.promo_redemptions r where r.promo_id = p.id and r.user_id = p_user_id)
    + (select count(*) from public.orders o
        where o.promo_id = p.id
          and o.user_id = p_user_id
          and o.status = 'pending_payment'
          and o.idempotency_key is distinct from p_exclude_idempotency_key)
  )
  from public.promos p
  where upper(p.code) = upper(trim(p_code));
$$;

revoke execute on function public.get_promo_for_checkout(text, uuid, text) from public, anon, authenticated;
grant execute on function public.get_promo_for_checkout(text, uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- Create a pending order and its snapshot lines in one transaction.
--
-- Idempotent on idempotency_key: a second call with the same key inserts
-- nothing and returns the existing order with created = false. The caller
-- (createCheckout) has already priced everything with calculateOrderTotal.
-- ----------------------------------------------------------------------------
create or replace function public.create_checkout_order(p_order jsonb, p_items jsonb)
returns table (order_id uuid, created boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  new_id uuid;
begin
  insert into public.orders (
    user_id, location_id, status, fulfillment, pickup_type, scheduled_for, estimated_ready_at,
    subtotal_cents, discount_cents, taxable_base_cents, tax_rate, tax_cents, tip_cents, total_cents,
    promo_id, promo_code, customer_first_name, customer_phone, customer_email, notes,
    idempotency_key, checkout_fingerprint
  )
  values (
    (p_order ->> 'user_id')::uuid,
    (p_order ->> 'location_id')::uuid,
    'pending_payment',
    'pickup',
    (p_order ->> 'pickup_type')::public.pickup_type,
    (p_order ->> 'scheduled_for')::timestamptz,
    (p_order ->> 'estimated_ready_at')::timestamptz,
    (p_order ->> 'subtotal_cents')::integer,
    (p_order ->> 'discount_cents')::integer,
    (p_order ->> 'taxable_base_cents')::integer,
    (p_order ->> 'tax_rate')::numeric,
    (p_order ->> 'tax_cents')::integer,
    (p_order ->> 'tip_cents')::integer,
    (p_order ->> 'total_cents')::integer,
    (p_order ->> 'promo_id')::uuid,
    p_order ->> 'promo_code',
    p_order ->> 'customer_first_name',
    p_order ->> 'customer_phone',
    p_order ->> 'customer_email',
    p_order ->> 'notes',
    p_order ->> 'idempotency_key',
    p_order ->> 'checkout_fingerprint'
  )
  on conflict (idempotency_key) do nothing
  returning id into new_id;

  if new_id is null then
    return query
      select o.id, false from public.orders o where o.idempotency_key = p_order ->> 'idempotency_key';
    return;
  end if;

  insert into public.order_items (
    order_id, product_id, product_size_id, product_name, size_name, modifiers,
    base_price_cents, unit_price_cents, quantity, line_total_cents, special_instructions
  )
  select
    new_id, item.product_id, item.product_size_id, item.product_name, item.size_name,
    coalesce(item.modifiers, '[]'::jsonb),
    item.base_price_cents, item.unit_price_cents, item.quantity, item.line_total_cents,
    nullif(item.special_instructions, '')
  from jsonb_to_recordset(p_items) as item (
    product_id uuid, product_size_id uuid, product_name text, size_name text, modifiers jsonb,
    base_price_cents integer, unit_price_cents integer, quantity integer, line_total_cents integer,
    special_instructions text
  );

  return query select new_id, true;
end;
$$;

revoke execute on function public.create_checkout_order(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_order(jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- A payment succeeded (webhook). Decides, under a row lock, what happens:
--
--   'placed'          order was waiting and the amount matches: payment
--                     recorded, order Placed (placed_at stamped by trigger),
--                     promo redemption recorded and counted
--   'rejected'        p_reject_reason given (location paused / closed / event
--                     over since checkout): payment recorded, order cancelled
--                     with that reason. The caller then refunds.
--   'amount_mismatch' amount or currency differs from the order: payment
--                     recorded, order left unplaced and flagged for review
--   'already_placed'  a replay or an out-of-order duplicate: nothing changes
--   'not_pending'     the order was cancelled / refunded meanwhile (expired,
--                     account deleted, refunded first). The caller checks
--                     whether money still needs returning.
--   'unknown_order'   no such order
-- ----------------------------------------------------------------------------
create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_payment_intent_id text,
  p_charge_id text,
  p_amount_cents integer,
  p_currency text,
  p_raw jsonb default null,
  p_reject_reason text default null
)
returns text
language plpgsql
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  inserted integer;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return 'unknown_order';
  end if;

  -- Record the money whatever else happens -- it was captured. Never
  -- downgrade a refund that has already been recorded.
  update public.payments
     set status = case when status in ('refunded', 'partially_refunded') then status else 'succeeded' end,
         provider_charge_id = coalesce(nullif(p_charge_id, ''), provider_charge_id),
         failure_code = null,
         failure_message = null,
         raw = coalesce(p_raw, raw)
   where provider_payment_intent_id = p_payment_intent_id;

  if not found then
    insert into public.payments (order_id, provider_payment_intent_id, provider_charge_id, status, amount_cents, tip_cents, raw)
    values (o.id, p_payment_intent_id, nullif(p_charge_id, ''), 'succeeded', p_amount_cents, o.tip_cents, p_raw);
  end if;

  if o.status <> 'pending_payment' then
    if o.status in ('placed', 'accepted', 'preparing', 'ready', 'picked_up') then
      return 'already_placed';
    end if;
    return 'not_pending';
  end if;

  if p_amount_cents <> o.total_cents or lower(p_currency) <> 'usd' then
    update public.orders
       set review_reason = format('Payment of %s %s did not match the order total of %s usd',
                                  p_amount_cents, lower(p_currency), o.total_cents),
           flagged_for_review_at = now()
     where id = o.id;
    return 'amount_mismatch';
  end if;

  if p_reject_reason is not null then
    update public.orders
       set status = 'cancelled', cancellation_reason = p_reject_reason
     where id = o.id;
    return 'rejected';
  end if;

  update public.orders set status = 'placed' where id = o.id;

  if o.promo_id is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, amount_cents)
    values (o.promo_id, o.user_id, o.id, o.discount_cents)
    on conflict (promo_id, order_id) do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      update public.promos set times_used = times_used + 1 where id = o.promo_id;
    end if;
  end if;

  return 'placed';
end;
$$;

revoke execute on function public.mark_order_paid(uuid, text, text, integer, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, text, integer, text, jsonb, text) to service_role;

-- ----------------------------------------------------------------------------
-- A payment attempt failed (webhook). The order stays pending so the customer
-- can retry with the same PaymentIntent. A late failure event never
-- overwrites a success or a refund that has already been recorded.
-- ----------------------------------------------------------------------------
create or replace function public.record_payment_failure(
  p_payment_intent_id text,
  p_code text,
  p_message text
)
returns boolean
language sql
set search_path = public, pg_temp
as $$
  with updated as (
    update public.payments
       set status = 'failed', failure_code = p_code, failure_message = p_message
     where provider_payment_intent_id = p_payment_intent_id
       and status in ('requires_payment', 'processing', 'failed')
    returning 1
  )
  select exists (select 1 from updated);
$$;

revoke execute on function public.record_payment_failure(text, text, text) from public, anon, authenticated;
grant execute on function public.record_payment_failure(text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- Money has been refunded on a payment (webhook, or our own refund call).
-- Updates the running total -- never lowering it, so events may arrive in any
-- order -- and, once the payment is fully refunded, moves the order along:
-- an order still in progress is cancelled then marked refunded; a cancelled
-- or picked-up order is marked refunded. Returns the order's status.
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

comment on function public.mark_order_paid is
  'Webhook: records a successful payment and places, rejects or flags the order. Service role only.';

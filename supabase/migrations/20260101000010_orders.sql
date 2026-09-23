-- ============================================================================
-- Orders.
--
-- Two rules shape this table:
--   1. Every money column is an integer count of cents, computed server-side.
--      The client never sends an amount that is trusted.
--   2. order_items store a SNAPSHOT of the product, size, modifiers and price.
--      Renaming a drink or raising a price tomorrow must not rewrite history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Daily counters behind the human-readable order and catering numbers.
--
-- The numbers are column DEFAULTs rather than BEFORE INSERT triggers so the
-- generated TypeScript Insert types mark them optional.
--
-- Every numbering function takes an optional `as_of` instant (default now()).
-- Production never passes it; it exists so the HST date rollover can be
-- regression-tested at fixed instants (supabase/tests/numbering.test.sql).
-- ----------------------------------------------------------------------------
create table public.daily_counters (
  scope       text not null,
  counter_day date not null,
  last_value  integer not null default 0,
  primary key (scope, counter_day)
);

create or replace function public.next_daily_number(
  counter_scope text,
  as_of timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- The Honolulu date, not the UTC one: an 11 PM HST order is already
  -- "tomorrow" in UTC but must still count towards today.
  day_hst date := public.cafe_date(as_of);
  next_value integer;
begin
  -- ON CONFLICT ... RETURNING makes this atomic under concurrent checkouts.
  insert into public.daily_counters (scope, counter_day, last_value)
  values (counter_scope, day_hst, 1)
  on conflict (scope, counter_day)
  do update set last_value = daily_counters.last_value + 1
  returning last_value into next_value;

  return next_value;
end;
$$;

-- Orders look like DC-260923-0042 (HST date, then that day's sequence).
create or replace function public.next_order_number(as_of timestamptz default now())
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select 'DC-'
    || to_char(public.cafe_date(as_of), 'YYMMDD')
    || '-'
    || lpad(public.next_daily_number('order', as_of)::text, 4, '0');
$$;

-- Only the numbering defaults may bump a counter; otherwise any signed-in
-- user could burn numbers or fill daily_counters with junk scopes via RPC.
-- Orders are inserted only by the service role (see orders RLS), so
-- customers need no EXECUTE on next_order_number() either.
revoke execute on function public.next_daily_number(text, timestamptz) from public, anon, authenticated;
revoke execute on function public.next_order_number(timestamptz) from public, anon, authenticated;
grant execute on function public.next_order_number(timestamptz) to service_role;

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  -- Human-facing, e.g. DC-260923-0042.
  order_number        text not null unique default public.next_order_number()
                      check (order_number <> ''),

  -- Null only once the customer has deleted their account: the order stays
  -- for sales and tax reports, detached from them (see anonymized_at).
  user_id             uuid references public.profiles (id) on delete set null,
  location_id         uuid not null references public.locations (id) on delete restrict,

  status              public.order_status not null default 'pending_payment',
  fulfillment         public.fulfillment_type not null default 'pickup',
  pickup_type         public.pickup_type not null default 'asap',

  -- Set when pickup_type = 'scheduled'; a 15-minute slot start.
  scheduled_for       timestamptz,
  -- Quoted at checkout and refreshed when the barista accepts.
  estimated_ready_at  timestamptz,

  -- ---- Money, all server-computed. See lib/pricing/calculateOrderTotal. ----
  subtotal_cents      integer not null default 0 check (subtotal_cents >= 0),
  discount_cents      integer not null default 0 check (discount_cents >= 0),
  -- subtotal - discount; the base the GET is actually charged on.
  taxable_base_cents  integer not null default 0 check (taxable_base_cents >= 0),
  -- Rate in force at the time of the order, kept so old receipts stay correct
  -- after an admin edits the setting. 0.04712 = 4.712%.
  tax_rate            numeric(7, 5) not null default 0 check (tax_rate >= 0 and tax_rate < 1),
  tax_cents           integer not null default 0 check (tax_cents >= 0),
  -- Tips are excluded from the taxed amount and reported separately.
  tip_cents           integer not null default 0 check (tip_cents >= 0),
  total_cents         integer not null default 0 check (total_cents >= 0),

  -- ---- Discounts applied ----
  promo_id            uuid references public.promos (id) on delete set null,
  promo_code          text,
  reward_id           uuid references public.rewards (id) on delete set null,
  reward_name         text,
  points_earned       integer not null default 0 check (points_earned >= 0),
  points_redeemed     integer not null default 0 check (points_redeemed >= 0),

  -- ---- Snapshot of who to call at the counter ----
  customer_first_name text,
  customer_phone      text,
  customer_email      text,
  notes               text,

  -- Supplied by the client on order creation. A double-tapped pay button
  -- reuses the key and returns the existing order instead of making a second.
  idempotency_key     text not null unique,

  placed_at           timestamptz,
  accepted_at         timestamptz,
  preparing_at        timestamptz,
  ready_at            timestamptz,
  picked_up_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,

  -- Set by account deletion when the customer's personal fields were scrubbed
  -- and user_id detached. See delete_account_data().
  anonymized_at       timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint orders_scheduled_needs_time check (
    pickup_type <> 'scheduled' or scheduled_for is not null
  ),
  constraint orders_cancel_needs_reason check (
    status <> 'cancelled' or cancellation_reason is not null
  ),
  -- An order without an owner is only legitimate after an account deletion.
  -- This stops a checkout bug from writing orphaned orders, and stops a user
  -- being deleted around the anonymising flow (the FK's SET NULL would fail).
  constraint orders_owner_or_anonymized check (
    user_id is not null or anonymized_at is not null
  )
);

-- The barista queue: open orders at one location, oldest first.
create index orders_location_status_idx on public.orders (location_id, status, placed_at);
-- "My orders", newest first.
create index orders_user_created_idx on public.orders (user_id, created_at desc);
-- Reporting by day.
create index orders_placed_at_idx on public.orders (placed_at) where placed_at is not null;
create index orders_promo_idx on public.orders (promo_id) where promo_id is not null;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- promo_redemptions could not reference orders when it was created.
alter table public.promo_redemptions
  add constraint promo_redemptions_order_id_fkey
  foreign key (order_id) references public.orders (id) on delete cascade;

comment on column public.orders.tax_rate is 'GET rate in force when the order was placed; 0.04712 = 4.712%.';
comment on column public.orders.idempotency_key is 'Client-generated; makes order creation safe to retry.';

-- ----------------------------------------------------------------------------
-- Order lines. product_id / product_size_id are nullable references kept only
-- for reporting joins -- every field the customer or barista actually sees is
-- denormalised onto the row.
-- ----------------------------------------------------------------------------
create table public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete cascade,

  product_id           uuid references public.products (id) on delete set null,
  product_size_id      uuid references public.product_sizes (id) on delete set null,

  -- ---- Snapshot ----
  product_name         text not null,
  size_name            text,
  -- Shape: [{ group_id, group_name, option_id, option_name, quantity,
  --           price_delta_cents }]
  modifiers            jsonb not null default '[]'::jsonb,

  -- Size price (or product base price) before modifiers.
  base_price_cents     integer not null check (base_price_cents >= 0),
  -- base + every modifier delta, for ONE unit.
  unit_price_cents     integer not null check (unit_price_cents >= 0),
  quantity             integer not null default 1 check (quantity > 0 and quantity <= 99),
  line_total_cents     integer not null check (line_total_cents >= 0),

  special_instructions text check (special_instructions is null or char_length(special_instructions) <= 100),

  created_at           timestamptz not null default now()
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

comment on table public.order_items is
  'Immutable snapshot of what was ordered; later menu edits never alter past orders.';

-- ----------------------------------------------------------------------------
-- Append-only audit of every status change, written by a trigger.
-- ----------------------------------------------------------------------------
create table public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  from_status public.order_status,
  to_status   public.order_status not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now()
);

create index order_status_history_order_idx on public.order_status_history (order_id, created_at);

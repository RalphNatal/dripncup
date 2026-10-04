-- ============================================================================
-- Phase 7: Overflow Rewards.
--
--   loyalty.* settings      every rule the cafe has not confirmed yet is a
--                           setting (earn rate, stacking, rewards per order,
--                           catering, expiry), so their answers are data
--   rewards                 free_item / free_modifier / amount_off, with
--                           eligibility and a value cap
--   loyalty_transactions    the append-only ledger: earn, redeem, release,
--                           reverse, adjust, expire. The cached balance on
--                           profiles may now go below zero
--   loyalty_reservations    points held by a checkout until it is paid
--                           (redeemed) or abandoned (released)
--   order_rewards           which rewards an order used, on which line
--   sync_order_loyalty()    one forward-only reconcile, run by triggers on
--                           order status and refunds: holds become
--                           redemptions, cancellations return points, pickup
--                           earns, refunds reverse
--   member codes            opaque, regenerable; staff lookup returns only a
--                           first name and a balance
--   admin_adjust_points()   manual corrections with a reason and an actor
--
-- See ARCHITECTURE.md, "Overflow Rewards", for the lifecycle.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Settings. All NEEDS_CONFIRMATION with the owner; public so the rewards page
-- can explain the programme to guests.
-- ----------------------------------------------------------------------------
update public.settings
   set value = '1'::jsonb,
       description = 'Overflow Rewards points per USD of the post-discount subtotal (tax and tip excluded), rounded down, credited at pickup. Up to two decimals. NEEDS_CONFIRMATION.'
 where key = 'loyalty.points_per_dollar';

insert into public.settings (key, value, description, is_public) values
  ('loyalty.catering_earns_points', 'false'::jsonb,
   'Whether paid catering orders earn points. NEEDS_CONFIRMATION.', true),
  ('loyalty.points_expire_after_months', '0'::jsonb,
   'Points earned more than this many months ago expire (oldest first) when the expiry job runs. 0 = points never expire. NEEDS_CONFIRMATION.', true),
  ('loyalty.max_rewards_per_order', '1'::jsonb,
   'How many rewards one order may use. NEEDS_CONFIRMATION.', true),
  ('loyalty.allow_promo_with_reward', 'false'::jsonb,
   'false = one discount per order: a promo code or a reward, not both. NEEDS_CONFIRMATION.', true)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Rewards: eligibility and value caps.
--
--   free_item      one unit of an eligible line free, worth at most
--                  value_cents (null = no cap). covers_modifiers = false
--                  (default): the cap covers the size price and add-ons are
--                  charged; true: add-ons count towards the cap too
--   free_modifier  one unit of one priced add-on free, from the listed
--                  modifier groups (empty = any), up to value_cents
--   amount_off     value_cents off the order
--
-- applicable_product_ids / applicable_category_ids limit which lines a
-- reward can use (both empty = any). eligibility_label is the customer's
-- version ("any drink").
-- ----------------------------------------------------------------------------
alter table public.rewards
  add column covers_modifiers boolean not null default false,
  add column applicable_modifier_group_ids uuid[] not null default '{}',
  add column eligibility_label text,
  add constraint rewards_amount_off_has_value check (type <> 'amount_off' or value_cents is not null),
  add constraint rewards_name_not_blank check (btrim(name) <> '');

comment on column public.rewards.value_cents is
  'amount_off: the amount. free_item / free_modifier: the most the free item or add-on may be worth (null = no cap).';
comment on column public.rewards.covers_modifiers is
  'free_item only. false: the cap covers the size price and add-ons are charged. true: add-ons count towards the cap.';

-- ----------------------------------------------------------------------------
-- Orders: the reward part of the discount, and the reward columns that the
-- order_rewards table replaces.
-- ----------------------------------------------------------------------------
alter table public.orders
  drop column reward_id,
  drop column reward_name,
  add column reward_discount_cents integer not null default 0 check (reward_discount_cents >= 0),
  add constraint orders_reward_within_discount check (reward_discount_cents <= discount_cents);

comment on column public.orders.discount_cents is 'Promo plus reward discount. The promo part is discount_cents - reward_discount_cents.';
comment on column public.orders.points_earned is
  'Points this order earns when it is picked up, worked out at checkout (pointsForOrder). The ledger records whether they were credited.';
comment on column public.orders.points_redeemed is 'Points spent on rewards for this order (held at checkout; see loyalty_reservations).';

-- ----------------------------------------------------------------------------
-- Balances may go negative: a refund after the points were spent reverses
-- them anyway, so the ledger stays exact. A negative balance simply cannot
-- redeem anything until it is positive again.
-- ----------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_loyalty_points_check;

comment on column public.profiles.loyalty_points is
  'Cached sum of loyalty_transactions, maintained by trigger. May be negative after a refund reverses points already spent.';

-- ----------------------------------------------------------------------------
-- Member codes: 12 random characters from Crockford's base-32 alphabet (no
-- I, L, O or U), 60 bits. Nothing personal goes into them, and regenerating
-- one retires the old code.
-- ----------------------------------------------------------------------------
create or replace function public.generate_member_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  bytes bytea := extensions.gen_random_bytes(12);
  code text := '';
begin
  -- 256 is a multiple of 32, so every character is equally likely.
  for i in 0..11 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

revoke execute on function public.generate_member_code() from public, anon, authenticated;
grant execute on function public.generate_member_code() to service_role;

alter table public.profiles
  alter column member_code set default public.generate_member_code(),
  add column member_code_updated_at timestamptz not null default now();

-- Pre-launch: nobody has scanned an old-format code yet.
update public.profiles set member_code = public.generate_member_code();

alter table public.profiles
  add constraint profiles_member_code_format check (member_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$');

comment on column public.profiles.member_code is
  'Opaque member code (12 Crockford base-32 characters) shown as the member QR. Random; regenerate_member_code() replaces it.';

-- The signed-in customer's new code. The old one stops working at once.
create or replace function public.regenerate_member_code()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  code text;
begin
  if caller is null then
    raise exception 'Sign in to change your member code' using errcode = 'insufficient_privilege';
  end if;

  loop
    code := public.generate_member_code();
    begin
      update public.profiles
         set member_code = code, member_code_updated_at = now()
       where id = caller and deleted_at is null;
      if not found then
        raise exception 'No open account' using errcode = 'insufficient_privilege';
      end if;
      return code;
    exception
      -- One in 2^60, but cheap to handle: draw again.
      when unique_violation then null;
    end;
  end loop;
end;
$$;

revoke execute on function public.regenerate_member_code() from public, anon;
grant execute on function public.regenerate_member_code() to authenticated, service_role;

-- For a future in-store scanner: who is this member? Staff and admins only,
-- and only a first name and a balance -- no email, phone or history. Spaces,
-- dashes, lower case and the look-alikes O, I and L are forgiven, as Crockford
-- intends. An unknown code returns no rows.
create or replace function public.staff_lookup_member(p_code text)
returns table (first_name text, points integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  code text := translate(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'OIL', '011');
begin
  if not public.is_staff() then
    raise exception 'Only staff can look up members' using errcode = 'insufficient_privilege';
  end if;
  if char_length(code) <> 12 then
    return;
  end if;

  return query
    select coalesce(nullif(p.first_name, ''), nullif(split_part(p.full_name, ' ', 1), ''), 'Member'),
           p.loyalty_points
      from public.profiles p
     where p.member_code = code
       and p.deleted_at is null;
end;
$$;

revoke execute on function public.staff_lookup_member(text) from public, anon;
grant execute on function public.staff_lookup_member(text) to authenticated, service_role;

comment on function public.staff_lookup_member is
  'Staff/admin: first name and points balance for a member code. Nothing else about the member is returned.';

-- ----------------------------------------------------------------------------
-- Reservations: the points a checkout is holding.
--
--   held      checkout created the order; the points are already off the
--             balance (a redeem row), so a second checkout cannot spend them
--   redeemed  the order was paid (Placed)
--   released  the checkout expired, its payment was cancelled, or the order
--             was cancelled or fully refunded; a release row put the points
--             back. A partial refund does not release anything.
-- ----------------------------------------------------------------------------
create table public.loyalty_reservations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  order_id       uuid not null unique references public.orders (id) on delete cascade,
  points         integer not null check (points > 0),
  status         text not null default 'held' check (status in ('held', 'redeemed', 'released')),
  created_at     timestamptz not null default now(),
  redeemed_at    timestamptz,
  released_at    timestamptz,
  release_reason text,

  constraint loyalty_reservations_released_has_time check (status <> 'released' or released_at is not null)
);

create index loyalty_reservations_user_idx on public.loyalty_reservations (user_id, created_at desc);
create index loyalty_reservations_held_idx on public.loyalty_reservations (user_id) where status = 'held';

comment on table public.loyalty_reservations is
  'Points held by a checkout: held -> redeemed (paid) or released (abandoned, cancelled, fully refunded). Written only by SQL functions.';

-- ----------------------------------------------------------------------------
-- The ledger.
--   earn    (+) credited when an order is picked up, once per order
--   redeem  (-) points spent at checkout (held by a reservation)
--   release (+) a reservation given back, once per reservation
--   reverse (-) clawed back after a refund, in proportion to the money
--   adjust  (+/-) an admin correction, with a reason and who made it
--   expire  (-) points past the expiry age, when expiry is switched on
-- ----------------------------------------------------------------------------
alter table public.loyalty_transactions
  add column reservation_id uuid references public.loyalty_reservations (id) on delete cascade,
  add column created_by uuid references public.profiles (id) on delete set null,
  drop constraint loyalty_sign_matches_type,
  add constraint loyalty_sign_matches_type check (
    (type in ('earn', 'release') and points > 0)
    or (type in ('redeem', 'reverse', 'expire') and points < 0)
    or (type = 'adjust')
  ),
  add constraint loyalty_adjust_has_reason check (
    type <> 'adjust' or char_length(btrim(coalesce(description, ''))) >= 3
  ),
  add constraint loyalty_reservation_rows_linked check (
    type not in ('redeem', 'release') or reservation_id is not null
  );

create unique index loyalty_transactions_one_redeem_per_reservation_idx
  on public.loyalty_transactions (reservation_id) where type = 'redeem';
create unique index loyalty_transactions_one_release_per_reservation_idx
  on public.loyalty_transactions (reservation_id) where type = 'release';
create index loyalty_transactions_order_idx on public.loyalty_transactions (order_id) where order_id is not null;

comment on column public.loyalty_transactions.created_by is 'Who made an adjust entry. Null for entries the system made.';

-- The cached balance follows every insert, without the old floor at zero.
create or replace function public.apply_loyalty_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set loyalty_points = loyalty_points + new.points where id = new.user_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles set loyalty_points = loyalty_points - old.points where id = old.user_id;
    return old;
  end if;
  return null;
end;
$$;

-- Append-only: a correction is a new row, never an edit. (Rows are deleted
-- only with the account they belong to.) The one change allowed is a
-- reference becoming null, which is what ON DELETE SET NULL does when the
-- admin who made an adjustment deletes their account, or a reward is
-- deleted; without it those deletions would fail.
create or replace function public.forbid_loyalty_transaction_update()
returns trigger
language plpgsql
as $$
begin
  if new.id = old.id
     and new.user_id = old.user_id
     and new.type = old.type
     and new.points = old.points
     and new.description is not distinct from old.description
     and new.created_at = old.created_at
     and (new.order_id is not distinct from old.order_id or new.order_id is null)
     and (new.reward_id is not distinct from old.reward_id or new.reward_id is null)
     and (new.reservation_id is not distinct from old.reservation_id or new.reservation_id is null)
     and (new.created_by is not distinct from old.created_by or new.created_by is null) then
    return new;
  end if;
  raise exception 'The points ledger is append-only; add an adjustment instead'
    using errcode = 'check_violation';
end;
$$;

create trigger loyalty_transactions_append_only
  before update on public.loyalty_transactions
  for each row execute function public.forbid_loyalty_transaction_update();

-- ----------------------------------------------------------------------------
-- Which rewards an order used. A snapshot like order_items: the reward's
-- name, type and cost at the time, the discount it gave, and the line it was
-- applied to (null for amount_off). option_name is the free add-on.
-- ----------------------------------------------------------------------------
create table public.order_rewards (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  reward_id      uuid references public.rewards (id) on delete set null,
  reward_name    text not null,
  reward_type    public.reward_type not null,
  points_cost    integer not null check (points_cost > 0),
  discount_cents integer not null check (discount_cents >= 0),
  order_item_id  uuid references public.order_items (id) on delete cascade,
  option_name    text,
  created_at     timestamptz not null default now()
);

create index order_rewards_order_idx on public.order_rewards (order_id);

comment on table public.order_rewards is
  'Snapshot of the rewards an order used: name, cost, discount and the line it applied to. Written by create_checkout_order.';

-- ----------------------------------------------------------------------------
-- create_checkout_order: as before, plus the reward snapshot and the points
-- reservation, in the same transaction as the order.
--
-- The customer's profile row is locked while the balance is checked, so two
-- checkouts racing for the same points run one after the other and the
-- second sees what the first spent (DC004 when it cannot afford it; the whole
-- order rolls back). Line ids come from the caller so p_rewards can name the
-- line each reward applies to.
-- ----------------------------------------------------------------------------
drop function if exists public.create_checkout_order(jsonb, jsonb);

create function public.create_checkout_order(p_order jsonb, p_items jsonb, p_rewards jsonb default '[]'::jsonb)
returns table (order_id uuid, created boolean)
language plpgsql
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  new_id uuid;
  buyer uuid := (p_order ->> 'user_id')::uuid;
  points_needed integer := coalesce((p_order ->> 'points_redeemed')::integer, 0);
  reward_cents integer := coalesce((p_order ->> 'reward_discount_cents')::integer, 0);
  rewards jsonb := coalesce(p_rewards, '[]'::jsonb);
  available integer;
  held_id uuid;
begin
  insert into public.orders (
    user_id, location_id, status, fulfillment, pickup_type, scheduled_for, estimated_ready_at,
    subtotal_cents, discount_cents, reward_discount_cents, taxable_base_cents, tax_rate, tax_cents, tip_cents, total_cents,
    promo_id, promo_code, points_earned, points_redeemed,
    customer_first_name, customer_phone, customer_email, notes,
    idempotency_key, checkout_fingerprint
  )
  values (
    buyer,
    (p_order ->> 'location_id')::uuid,
    'pending_payment',
    'pickup',
    (p_order ->> 'pickup_type')::public.pickup_type,
    (p_order ->> 'scheduled_for')::timestamptz,
    (p_order ->> 'estimated_ready_at')::timestamptz,
    (p_order ->> 'subtotal_cents')::integer,
    (p_order ->> 'discount_cents')::integer,
    reward_cents,
    (p_order ->> 'taxable_base_cents')::integer,
    (p_order ->> 'tax_rate')::numeric,
    (p_order ->> 'tax_cents')::integer,
    (p_order ->> 'tip_cents')::integer,
    (p_order ->> 'total_cents')::integer,
    (p_order ->> 'promo_id')::uuid,
    p_order ->> 'promo_code',
    coalesce((p_order ->> 'points_earned')::integer, 0),
    points_needed,
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
    id, order_id, product_id, product_size_id, product_name, size_name, modifiers,
    base_price_cents, unit_price_cents, quantity, line_total_cents, special_instructions
  )
  select
    coalesce(item.id, gen_random_uuid()), new_id, item.product_id, item.product_size_id, item.product_name, item.size_name,
    coalesce(item.modifiers, '[]'::jsonb),
    item.base_price_cents, item.unit_price_cents, item.quantity, item.line_total_cents,
    nullif(item.special_instructions, '')
  from jsonb_to_recordset(p_items) as item (
    id uuid, product_id uuid, product_size_id uuid, product_name text, size_name text, modifiers jsonb,
    base_price_cents integer, unit_price_cents integer, quantity integer, line_total_cents integer,
    special_instructions text
  );

  if jsonb_array_length(rewards) = 0 and points_needed = 0 and reward_cents = 0 then
    return query select new_id, true;
    return;
  end if;

  -- The rewards must account for exactly the points and discount on the order.
  if jsonb_array_length(rewards) = 0
     or points_needed <= 0
     or points_needed <> (select coalesce(sum((r ->> 'points_cost')::integer), 0) from jsonb_array_elements(rewards) r)
     or reward_cents <> (select coalesce(sum((r ->> 'discount_cents')::integer), 0) from jsonb_array_elements(rewards) r) then
    raise exception 'The rewards do not match the order''s points and discount' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.order_rewards (order_id, reward_id, reward_name, reward_type, points_cost, discount_cents, order_item_id, option_name)
  select new_id, r.reward_id, r.reward_name, r.reward_type::public.reward_type, r.points_cost, r.discount_cents,
         r.order_item_id, nullif(r.option_name, '')
  from jsonb_to_recordset(rewards) as r (
    reward_id uuid, reward_name text, reward_type text, points_cost integer, discount_cents integer,
    order_item_id uuid, option_name text
  );

  if exists (
    select 1 from public.order_rewards r
     where r.order_id = new_id
       and r.order_item_id is not null
       and not exists (select 1 from public.order_items i where i.id = r.order_item_id and i.order_id = new_id)
  ) then
    raise exception 'A reward names a line from another order' using errcode = 'invalid_parameter_value';
  end if;

  -- The lock that makes double-spending impossible.
  select loyalty_points into available
    from public.profiles
   where id = buyer and deleted_at is null
     for update;

  if available is null or available < points_needed then
    raise exception 'Not enough points for this reward' using errcode = 'DC004';
  end if;

  insert into public.loyalty_reservations (user_id, order_id, points)
  values (buyer, new_id, points_needed)
  returning id into held_id;

  insert into public.loyalty_transactions (user_id, order_id, reservation_id, type, points, description)
  values (
    buyer, new_id, held_id, 'redeem', -points_needed,
    (select string_agg(r ->> 'reward_name', ', ') from jsonb_array_elements(rewards) r)
  );

  return query select new_id, true;
end;
$$;

revoke execute on function public.create_checkout_order(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_order(jsonb, jsonb, jsonb) to service_role;

comment on function public.create_checkout_order is
  'Checkout: a pending order, its snapshot lines and rewards, and the points reservation, idempotent on the key. Service role only.';

-- ----------------------------------------------------------------------------
-- An order a reward paid for in full ($0.00) has no payment to wait for:
-- checkout places it straight away through this function (the only path to
-- Placed besides mark_order_paid). Refuses anything that costs money.
-- ----------------------------------------------------------------------------
create or replace function public.place_free_order(p_order_id uuid)
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
  if o.status <> 'pending_payment' then
    return case when o.status in ('placed', 'accepted', 'preparing', 'ready', 'picked_up') then 'already_placed' else 'not_pending' end;
  end if;
  if o.total_cents <> 0 then
    return 'not_free';
  end if;

  update public.orders set status = 'placed' where id = o.id;

  if o.promo_id is not null then
    insert into public.promo_redemptions (promo_id, user_id, order_id, amount_cents)
    values (o.promo_id, o.user_id, o.id, o.discount_cents - o.reward_discount_cents)
    on conflict (promo_id, order_id) do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      update public.promos set times_used = times_used + 1 where id = o.promo_id;
    end if;
  end if;

  return 'placed';
end;
$$;

revoke execute on function public.place_free_order(uuid) from public, anon, authenticated;
grant execute on function public.place_free_order(uuid) to service_role;

-- mark_order_paid recorded the whole discount as the promo's; only the promo
-- part belongs there now that rewards share discount_cents.
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
    values (o.promo_id, o.user_id, o.id, o.discount_cents - o.reward_discount_cents)
    on conflict (promo_id, order_id) do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      update public.promos set times_used = times_used + 1 where id = o.promo_id;
    end if;
  end if;

  return 'placed';
end;
$$;

-- ----------------------------------------------------------------------------
-- sync_order_loyalty: makes the ledger agree with one order. Called by the
-- triggers below on every status change and every change to the refunded
-- amount, so it holds whichever code path (webhook, staff, expiry job, refund,
-- account deletion, psql) moved the order.
--
-- Forward-only and idempotent: each step appends only what is missing, and
-- the unique indexes (one earn per order, one release per reservation) make
-- a replay or a race a no-op. A replayed webhook therefore cannot credit,
-- redeem or return points twice.
--
--   reservation  held + Placed..Picked up            -> redeemed
--                held/redeemed + cancelled/refunded  -> released, points back
--   earn         picked up (now or before) and points_earned > 0 -> one earn
--   reverse      the share of the earn matching the share of the payment
--                refunded, rounded down; all of it once the order is
--                refunded in full. Topped up as further refunds arrive.
-- ----------------------------------------------------------------------------
create or replace function public.sync_order_loyalty(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  res public.loyalty_reservations;
  earned integer;
  reversed integer;
  paid integer;
  refunded integer;
  target integer;
begin
  -- Serialises with any other change to this order (a trigger caller already
  -- holds this lock).
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.user_id is null then
    return;
  end if;

  -- 1. The reservation.
  select * into res from public.loyalty_reservations where order_id = o.id for update;
  if found then
    if res.status = 'held' and o.status in ('placed', 'accepted', 'preparing', 'ready', 'picked_up') then
      update public.loyalty_reservations set status = 'redeemed', redeemed_at = now() where id = res.id;
    elsif res.status <> 'released' and o.status in ('cancelled', 'refunded') then
      update public.loyalty_reservations
         set status = 'released',
             released_at = now(),
             release_reason = case when o.status = 'refunded' then 'Order refunded' else coalesce(o.cancellation_reason, 'Order cancelled') end
       where id = res.id;
      insert into public.loyalty_transactions (user_id, order_id, reservation_id, type, points, description)
      values (res.user_id, o.id, res.id, 'release', res.points,
              case when o.status = 'refunded' then 'Order refunded' else 'Order cancelled' end)
      on conflict (reservation_id) where type = 'release' do nothing;
    end if;
  end if;

  -- 2. Earn, at pickup.
  if o.picked_up_at is not null and o.points_earned > 0 then
    insert into public.loyalty_transactions (user_id, order_id, type, points, description)
    values (o.user_id, o.id, 'earn', o.points_earned, 'Order ' || o.order_number)
    on conflict (order_id) where type = 'earn' and order_id is not null do nothing;
  end if;

  -- 3. Reverse after refunds.
  select points into earned from public.loyalty_transactions where order_id = o.id and type = 'earn';
  if coalesce(earned, 0) > 0 then
    select coalesce(sum(p.amount_cents), 0), coalesce(sum(least(p.refunded_cents, p.amount_cents)), 0)
      into paid, refunded
      from public.payments p
     where p.order_id = o.id and p.status in ('succeeded', 'partially_refunded', 'refunded');

    if o.status = 'refunded' then
      target := earned;
    elsif paid > 0 then
      -- Integer division rounds down, in the customer's favour.
      target := (earned::bigint * refunded / paid)::integer;
    else
      target := 0;
    end if;

    select coalesce(-sum(points), 0) into reversed
      from public.loyalty_transactions
     where order_id = o.id and type = 'reverse';

    if target > reversed then
      insert into public.loyalty_transactions (user_id, order_id, type, points, description)
      values (o.user_id, o.id, 'reverse', -(target - reversed), 'Refund on order ' || o.order_number);
    end if;
  end if;
end;
$$;

revoke execute on function public.sync_order_loyalty(uuid) from public, anon, authenticated;
grant execute on function public.sync_order_loyalty(uuid) to service_role;

create or replace function public.orders_sync_loyalty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    perform public.sync_order_loyalty(new.id);
  end if;
  return new;
end;
$$;

create trigger orders_sync_loyalty
  after update of status on public.orders
  for each row execute function public.orders_sync_loyalty();

create or replace function public.payments_sync_loyalty()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.refunded_cents is distinct from old.refunded_cents then
    perform public.sync_order_loyalty(new.order_id);
  end if;
  return new;
end;
$$;

create trigger payments_sync_loyalty
  after update of refunded_cents on public.payments
  for each row execute function public.payments_sync_loyalty();

-- ----------------------------------------------------------------------------
-- Manual adjustments. A signed-in caller must be an admin; with no signed-in
-- user it is the server (service role) or a direct database session such as
-- Supabase Studio's SQL editor. A reason is required, and the admin is
-- recorded. The balance may go negative.
--
--   select public.admin_adjust_points(
--     (select id from public.profiles where email = 'customer@drincup.test'),
--     300, 'Hand testing');
-- ----------------------------------------------------------------------------
create or replace function public.admin_adjust_points(
  p_user_id uuid,
  p_points integer,
  p_reason text
)
returns public.loyalty_transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  reason text := btrim(coalesce(p_reason, ''));
  entry public.loyalty_transactions;
begin
  if caller is not null then
    if not public.is_admin() then
      raise exception 'Only admins can adjust points' using errcode = 'insufficient_privilege';
    end if;
  elsif coalesce(auth.role(), 'direct') not in ('service_role', 'direct') then
    raise exception 'Only admins can adjust points' using errcode = 'insufficient_privilege';
  end if;

  if p_points is null or p_points = 0 or abs(p_points) > 100000 then
    raise exception 'Adjust by a whole number of points other than zero' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(reason) < 3 then
    raise exception 'A reason is required' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and deleted_at is null) then
    raise exception 'No open account with id %', p_user_id using errcode = 'no_data_found';
  end if;

  insert into public.loyalty_transactions (user_id, type, points, description, created_by)
  values (p_user_id, 'adjust', p_points, left(reason, 200), caller)
  returning * into entry;

  return entry;
end;
$$;

revoke execute on function public.admin_adjust_points(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, integer, text) to authenticated, service_role;

comment on function public.admin_adjust_points is
  'Admin points correction with a required reason; records the admin. Callable from Studio (no signed-in user).';

-- ----------------------------------------------------------------------------
-- The signed-in customer's points activity, newest first, keyset-paginated
-- like list_my_orders. `kind` is what the customer reads: a redeem row is
-- "reserved" until its order is paid, "redeemed" after.
-- ----------------------------------------------------------------------------
create or replace function public.list_my_points_activity(
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 20
)
returns table (
  id           uuid,
  created_at   timestamptz,
  kind         text,
  points       integer,
  description  text,
  order_id     uuid,
  order_number text,
  -- held / redeemed / released, for redeem and release rows.
  reservation_status text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id,
    t.created_at,
    case t.type
      when 'earn' then 'earned'
      when 'redeem' then case when r.redeemed_at is not null then 'redeemed' else 'reserved' end
      when 'release' then 'returned'
      when 'reverse' then 'reversed'
      when 'adjust' then 'adjusted'
      when 'expire' then 'expired'
    end,
    t.points,
    t.description,
    t.order_id,
    o.order_number,
    r.status
  from public.loyalty_transactions t
  left join public.loyalty_reservations r on r.id = t.reservation_id
  left join public.orders o on o.id = t.order_id and o.user_id = t.user_id
  where auth.uid() is not null
    and t.user_id = auth.uid()
    and (
      p_before_created_at is null
      or (t.created_at, t.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
    )
  order by t.created_at desc, t.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke execute on function public.list_my_points_activity(timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_my_points_activity(timestamptz, uuid, integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Expiry, built and switched off (loyalty.points_expire_after_months = 0).
-- Worked out from the ledger alone, oldest points first: whatever a customer
-- was credited before the cutoff and has not spent since has expired.
--
--   expiring = credits before the cutoff (earn, positive adjust)
--            - every debit ever (redeem, reverse, expire, negative adjust)
--
-- A redeem that was released, and its release, cancel out and are left out.
-- Already-expired points are debits, so running it twice expires nothing more.
-- Returns how many customers lost points.
-- ----------------------------------------------------------------------------
create or replace function public.expire_loyalty_points(p_as_of timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  months integer := coalesce((public.get_setting('loyalty.points_expire_after_months') #>> '{}')::integer, 0);
  cutoff timestamptz;
  affected integer;
begin
  if months <= 0 then
    return 0;
  end if;
  cutoff := p_as_of - make_interval(months => months);
  perform pg_advisory_xact_lock(hashtext('public.expire_loyalty_points'));

  with per_user as (
    select t.user_id,
           sum(case when t.points > 0 and t.type in ('earn', 'adjust') and t.created_at < cutoff then t.points else 0 end) as old_credits,
           sum(case when t.points < 0 then -t.points else 0 end) as debits
      from public.loyalty_transactions t
      left join public.loyalty_reservations r on r.id = t.reservation_id
     where t.type <> 'release'
       and not (t.type = 'redeem' and r.status = 'released')
     group by t.user_id
  )
  insert into public.loyalty_transactions (user_id, type, points, description)
  select user_id, 'expire', -(old_credits - debits)::integer,
         format('Points older than %s months expired', months)
    from per_user
   where old_credits - debits > 0;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.expire_loyalty_points(timestamptz) from public, anon, authenticated;
grant execute on function public.expire_loyalty_points(timestamptz) to service_role;

-- ----------------------------------------------------------------------------
-- Account deletion: unchanged, plus the reservations. Cancelling the open
-- orders first releases any held points (the trigger above); then the whole
-- ledger and every reservation go with the account. order_rewards stay with
-- the anonymised orders: they hold no personal data.
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

  update public.orders
     set user_id = null,
         customer_first_name = null,
         customer_phone = null,
         customer_email = null,
         notes = null,
         anonymized_at = now()
   where user_id = target_user_id;

  update public.catering_requests
     set user_id = null,
         contact_name = null,
         contact_email = null,
         contact_phone = null,
         delivery_address = null,
         notes = null,
         custom_drink_request = null,
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

-- ----------------------------------------------------------------------------
-- Row level security. Customers read their own ledger, reservations and the
-- rewards on their orders; staff read the rewards on orders at their counter
-- (the ticket shows "Free drink"). Nobody writes any of it through the API:
-- the SQL functions above are the only writers.
-- ----------------------------------------------------------------------------
drop policy if exists loyalty_transactions_admin_write on public.loyalty_transactions;
revoke insert, update, delete, truncate on public.loyalty_transactions from anon, authenticated;

alter table public.loyalty_reservations enable row level security;

create policy loyalty_reservations_select_own on public.loyalty_reservations
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete, truncate on public.loyalty_reservations from anon, authenticated;

alter table public.order_rewards enable row level security;

create policy order_rewards_select on public.order_rewards
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_rewards.order_id
         and (o.user_id = auth.uid() or public.can_access_location(o.location_id))
    )
  );

revoke insert, update, delete, truncate on public.order_rewards from anon, authenticated;

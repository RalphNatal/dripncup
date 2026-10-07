-- ============================================================================
-- Phase 9: reports. Aggregated here, never in the browser.
--
-- Definitions (also in ARCHITECTURE.md, "Reports", and the info tooltips):
--
--   Which orders count  paid orders: every order that reached Placed
--                       (placed_at is set), including ones cancelled or
--                       refunded later. Unpaid, abandoned and unresolved
--                       flagged checkouts never count. A $0.00 order paid in
--                       full with a reward counts (its reward discount equals
--                       its gross sales).
--   Which day           the Honolulu calendar date the order was placed.
--   Refunds             by ORDER date: money given back is subtracted on the
--                       day of the order it belongs to, whenever the refund
--                       happened. So a day always describes the same orders,
--                       and the orders export adds up to the sales report
--                       exactly; a refund made today can change an earlier
--                       day's numbers. Refunded = the payment's refunded
--                       amount (refunds made from the Stripe dashboard
--                       included).
--   Splitting a refund  across sales, tax and tip in the order's own
--                       proportions (rounded half up to the cent; sales
--                       takes the remainder), so a full refund takes back
--                       exactly what the order added.
--   Gross sales         item prices with add-ons, before discounts (the
--                       order's subtotal).
--   Discounts           promo and reward parts, separately.
--   Net sales           gross - promo - reward - the sales part of refunds.
--                       Tax and tips are not sales.
--   Tax (GET)           tax charged, less the tax part of refunds.
--   Tips                tips charged, less the tip part of refunds; reported
--                       separately and never part of sales.
--   Average order value net sales before refunds (gross - discounts) per
--                       order.
--   Catering            reported separately, by the Honolulu date it was
--                       paid (confirmed), from the paid quote; refunds by
--                       the same rule as orders.
--
--   net sales + tax + tips = collected - refunded, for every order.
-- ============================================================================

create index if not exists orders_location_placed_idx on public.orders (location_id, placed_at) where placed_at is not null;
create index if not exists catering_requests_confirmed_idx on public.catering_requests (confirmed_at) where confirmed_at is not null;

-- Half-up division for non-negative integers: round(a * b / c).
create or replace function public.mul_div_round(a bigint, b bigint, c bigint)
returns bigint
language sql
immutable
as $$
  select case when c = 0 then 0 else (2 * a * b + c) / (2 * c) end;
$$;

-- One row per counted order in [p_from, p_to] (Honolulu dates, inclusive),
-- optionally at one location. Everything else is built on this, so the
-- sales report and the orders export cannot disagree. Not callable by
-- clients; the admin_report_* functions below are.
create or replace function public.report_order_facts(p_from date, p_to date, p_location_id uuid default null)
returns table (
  order_id                uuid,
  order_number            text,
  business_date           date,
  placed_at               timestamptz,
  location_id             uuid,
  location_name           text,
  location_type           public.location_type,
  status                  public.order_status,
  customer_first_name     text,
  item_count              integer,
  gross_sales_cents       integer,
  promo_discount_cents    integer,
  reward_discount_cents   integer,
  net_before_refunds_cents integer,
  tax_cents               integer,
  tip_cents               integer,
  total_cents             integer,
  refunded_cents          integer,
  refunded_sales_cents    integer,
  refunded_tax_cents      integer,
  refunded_tip_cents      integer,
  net_sales_cents         integer,
  net_tax_cents           integer,
  net_tip_cents           integer,
  promo_code              text,
  rewards                 text,
  points_earned           integer,
  points_redeemed         integer,
  payment_method          text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with base as (
    select
      o.*,
      l.name as l_name,
      l.type as l_type,
      least(coalesce(pay.refunded, 0), o.total_cents)::bigint as refunded,
      pay.method
    from public.orders o
    join public.locations l on l.id = o.location_id
    left join lateral (
      select sum(least(p.refunded_cents, p.amount_cents)) as refunded,
             max(coalesce(p.method_wallet, nullif(concat_ws(' ', p.method_brand, p.method_last4), ''))) as method
        from public.payments p
       where p.order_id = o.id and p.status in ('succeeded', 'partially_refunded', 'refunded')
    ) pay on true
    where o.placed_at is not null
      and o.placed_at >= (p_from::timestamp at time zone 'Pacific/Honolulu')
      and o.placed_at < ((p_to + 1)::timestamp at time zone 'Pacific/Honolulu')
      and (p_location_id is null or o.location_id = p_location_id)
  ),
  split as (
    select b.*,
           public.mul_div_round(b.refunded, b.tax_cents, b.total_cents) as r_tax,
           least(public.mul_div_round(b.refunded, b.tip_cents, b.total_cents),
                 b.refunded - public.mul_div_round(b.refunded, b.tax_cents, b.total_cents)) as r_tip
      from base b
  )
  select
    s.id,
    s.order_number,
    public.cafe_date(s.placed_at),
    s.placed_at,
    s.location_id,
    s.l_name,
    s.l_type,
    s.status,
    s.customer_first_name,
    (select coalesce(sum(i.quantity), 0)::integer from public.order_items i where i.order_id = s.id),
    s.subtotal_cents,
    s.discount_cents - s.reward_discount_cents,
    s.reward_discount_cents,
    s.taxable_base_cents,
    s.tax_cents,
    s.tip_cents,
    s.total_cents,
    s.refunded::integer,
    (s.refunded - s.r_tax - s.r_tip)::integer,
    s.r_tax::integer,
    s.r_tip::integer,
    (s.taxable_base_cents - (s.refunded - s.r_tax - s.r_tip))::integer,
    (s.tax_cents - s.r_tax)::integer,
    (s.tip_cents - s.r_tip)::integer,
    s.promo_code,
    (select string_agg(r.reward_name, '; ' order by r.created_at) from public.order_rewards r where r.order_id = s.id),
    s.points_earned,
    s.points_redeemed,
    s.method
  from split s;
$$;

revoke execute on function public.report_order_facts(date, date, uuid) from public, anon, authenticated;

create or replace function public.assert_report_range(p_from date, p_to date)
returns void
language plpgsql
immutable
as $$
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Pick a start date on or before the end date' using errcode = 'invalid_parameter_value';
  end if;
  if p_to - p_from > 731 then
    raise exception 'Reports cover up to two years at a time' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- Sales by day.
create or replace function public.admin_report_sales(p_from date, p_to date, p_location_id uuid default null)
returns table (
  business_date date,
  orders bigint,
  gross_sales_cents bigint,
  promo_discount_cents bigint,
  reward_discount_cents bigint,
  refunded_cents bigint,
  refunded_sales_cents bigint,
  net_sales_cents bigint,
  tax_cents bigint,
  tip_cents bigint,
  net_before_refunds_cents bigint,
  collected_cents bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public.assert_report_range(p_from, p_to);
  return query
    select f.business_date, count(*), sum(f.gross_sales_cents), sum(f.promo_discount_cents), sum(f.reward_discount_cents),
           sum(f.refunded_cents), sum(f.refunded_sales_cents), sum(f.net_sales_cents), sum(f.net_tax_cents),
           sum(f.net_tip_cents), sum(f.net_before_refunds_cents), sum(f.total_cents)
      from public.report_order_facts(p_from, p_to, p_location_id) f
     group by f.business_date
     order by f.business_date;
end;
$$;

-- The accountant's export: one row per counted order.
create or replace function public.admin_report_orders(p_from date, p_to date, p_location_id uuid default null)
returns table (
  order_id uuid, order_number text, business_date date, placed_at timestamptz, location_name text, status public.order_status,
  customer_first_name text, item_count integer, gross_sales_cents integer, promo_discount_cents integer,
  reward_discount_cents integer, net_before_refunds_cents integer, tax_cents integer, tip_cents integer, total_cents integer,
  refunded_cents integer, refunded_sales_cents integer, refunded_tax_cents integer, refunded_tip_cents integer,
  net_sales_cents integer, net_tax_cents integer, net_tip_cents integer, promo_code text, rewards text,
  points_earned integer, points_redeemed integer, payment_method text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public.assert_report_range(p_from, p_to);
  return query
    select f.order_id, f.order_number, f.business_date, f.placed_at, f.location_name, f.status, f.customer_first_name,
           f.item_count, f.gross_sales_cents, f.promo_discount_cents, f.reward_discount_cents, f.net_before_refunds_cents,
           f.tax_cents, f.tip_cents, f.total_cents, f.refunded_cents, f.refunded_sales_cents, f.refunded_tax_cents,
           f.refunded_tip_cents, f.net_sales_cents, f.net_tax_cents, f.net_tip_cents, f.promo_code, f.rewards,
           f.points_earned, f.points_redeemed, f.payment_method
      from public.report_order_facts(p_from, p_to, p_location_id) f
     order by f.placed_at, f.order_number;
end;
$$;

-- Top products by quantity and revenue (line totals: item prices with
-- add-ons, before order-level discounts), by the snapshot name.
create or replace function public.admin_report_products(p_from date, p_to date, p_location_id uuid default null, p_limit integer default 20)
returns table (product_id uuid, product_name text, quantity bigint, revenue_cents bigint, orders bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public.assert_report_range(p_from, p_to);
  return query
    select (array_agg(i.product_id order by i.created_at desc))[1], i.product_name, sum(i.quantity)::bigint,
           sum(i.line_total_cents)::bigint, count(distinct i.order_id)
      from public.report_order_facts(p_from, p_to, p_location_id) f
      join public.order_items i on i.order_id = f.order_id
     group by i.product_name
     order by 3 desc, 4 desc, 2
     limit greatest(1, least(coalesce(p_limit, 20), 200));
end;
$$;

-- Top add-ons: how many were chosen (option quantity x line quantity) and
-- what they added to line prices (per unit when charged per unit).
create or replace function public.admin_report_modifiers(p_from date, p_to date, p_location_id uuid default null, p_limit integer default 20)
returns table (group_name text, option_name text, quantity bigint, revenue_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public.assert_report_range(p_from, p_to);
  return query
    select coalesce(m ->> 'group_name', ''), coalesce(m ->> 'option_name', ''),
           sum(coalesce((m ->> 'quantity')::integer, 1) * i.quantity)::bigint,
           sum(
             coalesce((m ->> 'price_delta_cents')::integer, 0)
             * case when coalesce((m ->> 'charge_per_quantity')::boolean, true) then coalesce((m ->> 'quantity')::integer, 1) else 1 end
             * i.quantity
           )::bigint
      from public.report_order_facts(p_from, p_to, p_location_id) f
      join public.order_items i on i.order_id = f.order_id
      cross join lateral jsonb_array_elements(i.modifiers) m
     group by 1, 2
     order by 3 desc, 4 desc, 2
     limit greatest(1, least(coalesce(p_limit, 20), 200));
end;
$$;

-- Orders by Honolulu weekday (0 = Sunday) and hour.
create or replace function public.admin_report_peak_hours(p_from date, p_to date, p_location_id uuid default null)
returns table (weekday integer, hour integer, orders bigint, net_sales_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public.assert_report_range(p_from, p_to);
  return query
    select extract(dow from f.placed_at at time zone 'Pacific/Honolulu')::integer,
           extract(hour from f.placed_at at time zone 'Pacific/Honolulu')::integer,
           count(*), sum(f.net_before_refunds_cents)::bigint
      from public.report_order_facts(p_from, p_to, p_location_id) f
     group by 1, 2
     order by 1, 2;
end;
$$;

-- Promo codes and rewards used on counted orders.
create or replace function public.admin_report_discounts(p_from date, p_to date, p_location_id uuid default null)
returns table (kind text, name text, uses bigint, discount_cents bigint, points bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public.assert_report_range(p_from, p_to);
  return query
    select 'promo'::text, upper(f.promo_code), count(*), sum(f.promo_discount_cents)::bigint, 0::bigint
      from public.report_order_facts(p_from, p_to, p_location_id) f
     where f.promo_code is not null
     group by upper(f.promo_code)
    union all
    select 'reward', r.reward_name, count(*), sum(r.discount_cents)::bigint, sum(r.points_cost)::bigint
      from public.report_order_facts(p_from, p_to, p_location_id) f
      join public.order_rewards r on r.order_id = f.order_id
     group by r.reward_name
     order by 1, 3 desc, 2;
end;
$$;

-- Catering paid in the range (by the Honolulu date it was confirmed), from
-- the paid quote, with refunds by the same rule as orders.
create or replace function public.admin_report_catering(p_from date, p_to date, p_location_id uuid default null)
returns table (
  request_id uuid, request_number text, paid_date date, event_at timestamptz, status public.catering_status,
  contact_name text, headcount integer, items_cents integer, discount_cents integer, delivery_fee_cents integer,
  tax_cents integer, gratuity_cents integer, total_cents integer, refunded_cents integer, net_cents integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_admin();
  perform public.assert_report_range(p_from, p_to);
  return query
    select c.id, c.request_number, public.cafe_date(c.confirmed_at), c.event_at, c.status,
           coalesce(c.contact_name, 'Deleted account'), c.headcount,
           q.items_subtotal_cents, q.discount_cents, q.delivery_fee_cents, q.tax_cents, q.gratuity_cents, q.total_cents,
           coalesce(pay.refunded, 0)::integer,
           (q.total_cents - coalesce(pay.refunded, 0))::integer
      from public.catering_requests c
      join lateral (
        select * from public.catering_quotes cq
         where cq.catering_request_id = c.id and cq.status = 'paid'
         order by cq.version desc limit 1
      ) q on true
      left join lateral (
        select sum(least(p.refunded_cents, p.amount_cents)) as refunded
          from public.payments p
         where p.catering_request_id = c.id and p.catering_quote_id = q.id
           and p.status in ('succeeded', 'partially_refunded', 'refunded')
      ) pay on true
     where c.confirmed_at is not null
       and c.confirmed_at >= (p_from::timestamp at time zone 'Pacific/Honolulu')
       and c.confirmed_at < ((p_to + 1)::timestamp at time zone 'Pacific/Honolulu')
       and (p_location_id is null or c.location_id = p_location_id)
     order by c.confirmed_at;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_report_sales(date, date, uuid)',
    'public.admin_report_orders(date, date, uuid)',
    'public.admin_report_products(date, date, uuid, integer)',
    'public.admin_report_modifiers(date, date, uuid, integer)',
    'public.admin_report_peak_hours(date, date, uuid)',
    'public.admin_report_discounts(date, date, uuid)',
    'public.admin_report_catering(date, date, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

comment on function public.report_order_facts is
  'Reports: one row per paid order in a Honolulu date range, with refunds split across sales, tax and tip. Internal; see the admin_report_* functions.';

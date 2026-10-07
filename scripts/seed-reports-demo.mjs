/**
 * Reports demo data -- `npm run db:seed:reports-demo [-- --remove] [-- --e2e]`
 *
 * Fills a LOCAL database with six weeks of clearly fake paid orders so every
 * report and chart on /admin/reports has something to show: the cafe every
 * day (busier at weekends, mornings and lunch), two past pop-ups, promo codes,
 * rewards, tips, full and partial refunds, three paid catering requests, and
 * two attention-queue items (a failed email and a failed refund).
 *
 * Everything it makes is marked so it can never be mistaken for, or mixed
 * up with, real data, and is removed again by `-- --remove` (and replaced on
 * each run):
 *   orders        idempotency key "reports-demo-...", numbers DC-YYMMDD-9NNN
 *                 (real numbering never reaches 9000 a day)
 *   customers     demo-N@reports.drincup.test ("Demo Customer N")
 *   promo codes   DEMO-WELCOME10, DEMO-5OFF
 *   pop-ups       "... (reports demo)", switched off, never shown to customers
 *   catering      CAT-YYMMDD-9NN, contact demo-...@reports.drincup.test
 *   payments      pi_demo_..., refunds "Reports demo: ..."
 *
 * Orders are written directly (paid and picked up), not through checkout:
 * no Stripe calls, no emails queued, the order and catering counters are not
 * touched, and the points ledger is left alone. Runs in one transaction
 * through `docker exec` into the local database container; refuses unless
 * NEXT_PUBLIC_SUPABASE_URL is a loopback URL. `--e2e` targets the e2e
 * stack's container instead (used by e2e/reports.spec.ts).
 */
import { containerRunning, databaseContainer, isLoopbackUrl, projectIdOf, psql, readEnvFile } from "./lib/local-stack.mjs";

const REMOVE = process.argv.includes("--remove");
const E2E = process.argv.includes("--e2e");

const env = { ...readEnvFile(".env"), ...readEnvFile(".env.local"), ...process.env };
if (!E2E && (!env.NEXT_PUBLIC_SUPABASE_URL || !isLoopbackUrl(env.NEXT_PUBLIC_SUPABASE_URL))) {
  console.error("Refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a local (127.0.0.1 / localhost) database.");
  process.exit(1);
}
const container = E2E ? databaseContainer(projectIdOf(".e2e-stack/supabase/config.toml")) : databaseContainer();
if (!containerRunning(container)) {
  console.error(`The database container "${container}" is not running.${E2E ? " Run npm run test:e2e once to create it." : " Start it with npm run db:start."}`);
  process.exit(1);
}

const CLEANUP = `
  -- Paid orders' lines are frozen; lift that for this transaction only.
  alter table public.order_items disable trigger order_items_freeze;
  delete from public.email_outbox where dedupe_key like 'reports-demo%';
  delete from public.orders where idempotency_key like 'reports-demo-%';
  alter table public.order_items enable trigger order_items_freeze;
  delete from public.catering_requests where contact_email like '%@reports.drincup.test';
  delete from public.promos where code in ('DEMO-WELCOME10', 'DEMO-5OFF');
  delete from auth.users where email like '%@reports.drincup.test';
  delete from public.locations where slug like 'reports-demo-%';
`;

const SEED = String.raw`
do $demo$
declare
  cafe uuid := (select id from public.locations where type = 'cafe' order by sort_order, created_at limit 1);
  ev1 uuid := gen_random_uuid();
  ev2 uuid := gen_random_uuid();
  ev1_day date := public.cafe_today() - 19;
  ev2_day date := public.cafe_today() - 5;
  promo_pct uuid := gen_random_uuid();
  promo_fixed uuid := gen_random_uuid();
  reward record;
  syrup record;
  users uuid[];
  d integer;
  day date;
  n integer;
  per_day integer;
  seq integer;
  loc uuid;
  placed timestamptz;
  lines integer;
  li integer;
  prod record;
  v_order uuid;
  item_id uuid;
  first_item uuid;
  first_base integer;
  first_line integer;
  unit integer;
  qty integer;
  mods jsonb;
  subtotal integer;
  v_promo uuid;
  v_code text;
  promo_off integer;
  reward_off integer;
  taxable integer;
  tax integer;
  tip integer;
  total integer;
  r double precision;
  v_status public.order_status;
  refunded integer;
  pay_status public.payment_status;
  pick timestamptz;
  failed_email_done boolean := false;
  failed_refund_done boolean := false;
  hours integer[] := array[7,7,7,8,8,8,8,8,9,9,9,10,10,11,11,12,12,12,13,13,14,15,15,16,17];
begin
  perform setseed(0.4242);
  if cafe is null then
    raise exception 'No cafe: run npm run db:seed first';
  end if;

  -- Demo customers (the profile trigger makes their profiles).
  for n in 1..8 loop
    insert into auth.users (id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'demo-' || n || '@reports.drincup.test', jsonb_build_object('full_name', 'Demo Customer ' || n));
  end loop;
  users := array(select id from public.profiles where email like 'demo-%@reports.drincup.test' order by email);

  -- Two past pop-ups, switched off so customers and staff never see them.
  insert into public.locations (id, type, name, slug, starts_at, ends_at, is_active, is_published, accepting_orders)
  values
    (ev1, 'event', 'Kakaʻako Night Market (reports demo)', 'reports-demo-kakaako', (ev1_day + time '16:00') at time zone 'Pacific/Honolulu', (ev1_day + time '22:00') at time zone 'Pacific/Honolulu', false, false, false),
    (ev2, 'event', 'Aloha Friday Pop-up (reports demo)', 'reports-demo-aloha-friday', (ev2_day + time '10:00') at time zone 'Pacific/Honolulu', (ev2_day + time '15:00') at time zone 'Pacific/Honolulu', false, false, false);

  insert into public.promos (id, code, description, type, percent, amount_cents, min_spend_cents, starts_at, is_active)
  values
    (promo_pct, 'DEMO-WELCOME10', 'Reports demo code', 'percent', 10, null, 0, now() - interval '60 days', false),
    (promo_fixed, 'DEMO-5OFF', 'Reports demo code', 'fixed', null, 500, 1000, now() - interval '60 days', false);

  select id, name, type, points_cost, value_cents into reward from public.rewards where type = 'free_item' and is_active order by points_cost limit 1;
  create temp table demo_options on commit drop as
    select o.id as option_id, o.name as option_name, g.id as group_id, g.name as group_name, o.price_delta_cents,
           g.charge_per_quantity, g.quantity_unit
      from public.modifier_options o join public.modifier_groups g on g.id = o.modifier_group_id
     where o.is_active and g.is_active and o.price_delta_cents > 0;

  create temp table demo_products on commit drop as
    select p.id, p.name, s.id as size_id, s.name as size_name, coalesce(s.price_cents, p.base_price_cents) as price,
           s.id is not null as is_drink, row_number() over (order by p.sort_order, p.name) as idx
      from public.products p
      left join public.product_sizes s on s.product_id = p.id and s.is_default and s.is_active
     where p.is_active and p.archived_at is null and coalesce(s.price_cents, p.base_price_cents) > 0;

  -- Orders go straight to their final state (no steps, no emails); the
  -- loyalty trigger stays on, so pickups earn demo customers points.
  alter table public.orders disable trigger orders_enforce_status_transition;
  alter table public.orders disable trigger orders_enqueue_emails;

  for d in 1..42 loop
    day := public.cafe_today() - d;
    per_day := 9 + (case when extract(dow from day) in (0, 6) then 6 else 0 end) + floor(random() * 7)::integer;
    seq := 9000;
    for n in 1..(per_day + case when day in (ev1_day, ev2_day) then 14 else 0 end) loop
      seq := seq + 1;
      if n > per_day then
        loc := case when day = ev1_day then ev1 else ev2 end;
        placed := (day + make_time(case when day = ev1_day then 16 + floor(random() * 6)::integer else 10 + floor(random() * 5)::integer end, floor(random() * 60)::integer, 0)) at time zone 'Pacific/Honolulu';
      else
        loc := cafe;
        placed := (day + make_time(hours[1 + floor(random() * array_length(hours, 1))::integer], floor(random() * 60)::integer, 0)) at time zone 'Pacific/Honolulu';
      end if;

      v_order := gen_random_uuid();
      lines := 1 + floor(random() * random() * 3)::integer;
      subtotal := 0;
      first_item := null;

      insert into public.orders (id, order_number, user_id, location_id, status, idempotency_key, customer_first_name, customer_email, placed_at, created_at)
      values (v_order, 'DC-' || to_char(day, 'YYMMDD') || '-' || seq, users[1 + floor(random() * 8)::integer], loc, 'pending_payment',
              'reports-demo-' || v_order, 'Demo', 'demo@reports.drincup.test', placed, placed);

      for li in 1..lines loop
        select * into prod from demo_products order by random() limit 1;
        qty := case when random() < 0.85 then 1 else 2 end;
        mods := '[]'::jsonb;
        unit := prod.price;
        if prod.is_drink and random() < 0.35 then
          select * into syrup from demo_options order by random() limit 1;
          if found then
            mods := jsonb_build_array(jsonb_build_object(
              'group_id', syrup.group_id, 'group_name', syrup.group_name, 'option_id', syrup.option_id, 'option_name', syrup.option_name,
              'quantity', 1, 'price_delta_cents', syrup.price_delta_cents, 'charge_per_quantity', syrup.charge_per_quantity,
              'quantity_unit', syrup.quantity_unit));
            unit := unit + syrup.price_delta_cents;
          end if;
        end if;
        item_id := gen_random_uuid();
        insert into public.order_items (id, order_id, product_id, product_size_id, product_name, size_name, modifiers, base_price_cents, unit_price_cents, quantity, line_total_cents, created_at)
        values (item_id, v_order, prod.id, prod.size_id, prod.name, prod.size_name, mods, prod.price, unit, qty, unit * qty, placed);
        if first_item is null then
          first_item := item_id;
          first_base := prod.price;
          first_line := unit * qty;
        end if;
        subtotal := subtotal + unit * qty;
      end loop;

      -- Discounts: a promo on some orders, a reward on a few others.
      v_promo := null; v_code := null; promo_off := 0; reward_off := 0;
      r := random();
      if r < 0.07 then
        v_promo := promo_pct; v_code := 'DEMO-WELCOME10'; promo_off := (subtotal + 5) / 10;
      elsif r < 0.11 and subtotal >= 1000 then
        v_promo := promo_fixed; v_code := 'DEMO-5OFF'; promo_off := 500;
      elsif r < 0.16 and reward.id is not null then
        reward_off := least(first_base, coalesce(reward.value_cents, first_base));
      end if;
      taxable := subtotal - promo_off - reward_off;
      tax := (taxable * 4712 + 50000) / 100000;
      tip := case when random() < 0.45 then (taxable * (array[15, 18, 20])[1 + floor(random() * 3)::integer] + 50) / 100 else 0 end;
      total := taxable + tax + tip;

      -- What happened next: mostly picked up; a few refunded in full or in part.
      r := random();
      pick := placed + make_interval(mins => 6 + floor(random() * 10)::integer);
      if r < 0.03 then
        v_status := 'refunded'; refunded := total; pay_status := 'refunded';
      elsif r < 0.06 then
        v_status := 'picked_up'; refunded := least(first_line, total); pay_status := 'partially_refunded';
      else
        v_status := 'picked_up'; refunded := 0; pay_status := 'succeeded';
      end if;

      update public.orders
         set subtotal_cents = subtotal, discount_cents = promo_off + reward_off, reward_discount_cents = reward_off,
             taxable_base_cents = taxable, tax_rate = 0.04712, tax_cents = tax, tip_cents = tip, total_cents = total,
             promo_id = v_promo, promo_code = v_code,
             points_earned = taxable / 100, points_redeemed = case when reward_off > 0 then reward.points_cost else 0 end
       where id = v_order;
      -- Straight to its final state, as one write.
      update public.orders
         set status = v_status, accepted_at = placed + interval '1 minute', preparing_at = placed + interval '2 minutes',
             ready_at = pick - interval '1 minute', picked_up_at = case when v_status = 'picked_up' then pick end,
             cancelled_at = case when v_status = 'refunded' then pick end,
             cancellation_reason = case when v_status = 'refunded' then 'Reports demo: refunded' end
       where id = v_order;

      insert into public.payments (order_id, provider_payment_intent_id, provider_charge_id, status, amount_cents, tip_cents, refunded_cents,
                                   method_brand, method_last4, method_wallet, created_at)
      values (v_order, 'pi_demo_' || replace(v_order::text, '-', ''), 'ch_demo_' || seq, pay_status, total, tip, refunded,
              (array['visa', 'mastercard', 'amex', 'visa'])[1 + floor(random() * 4)::integer], lpad(floor(random() * 10000)::text, 4, '0'),
              case when random() < 0.25 then 'apple_pay' end, placed);
      if refunded > 0 then
        insert into public.refunds (order_id, payment_id, provider_refund_id, amount_cents, reason, status, created_at)
        select v_order, p.id, 're_demo_' || seq || '_' || d, refunded,
               case when refunded = total then 'Reports demo: customer changed their mind' else 'Reports demo: one drink remade' end,
               'succeeded', pick + interval '2 hours'
          from public.payments p where p.order_id = v_order;
      end if;
      if v_promo is not null then
        insert into public.promo_redemptions (promo_id, user_id, order_id, amount_cents, created_at)
        select v_promo, o.user_id, v_order, promo_off, placed from public.orders o where o.id = v_order;
      end if;
      if reward_off > 0 then
        insert into public.order_rewards (order_id, reward_id, reward_name, reward_type, points_cost, discount_cents, order_item_id, created_at)
        values (v_order, reward.id, reward.name, reward.type, reward.points_cost, reward_off, first_item, placed);
      end if;

      -- Two items for the admin's attention queue.
      if not failed_email_done and d = 2 then
        insert into public.email_outbox (kind, order_id, dedupe_key, status, attempts, last_error, next_attempt_at, created_at)
        values ('order_receipt', v_order, 'reports-demo-failed-email', 'failed', 6, 'Reports demo: the mail server refused the message (demo, not a real failure).', placed, placed);
        failed_email_done := true;
      elsif not failed_refund_done and d = 3 and v_status = 'picked_up' and refunded = 0 then
        insert into public.refunds (order_id, payment_id, amount_cents, reason, status, failure_reason, created_at)
        select v_order, p.id, least(300, total), 'Reports demo: goodwill refund', 'failed', 'Reports demo: the card was closed (demo, not a real failure).', pick + interval '1 hour'
          from public.payments p where p.order_id = v_order;
        failed_refund_done := true;
      end if;
    end loop;
  end loop;

  alter table public.orders enable trigger orders_enforce_status_transition;
  alter table public.orders enable trigger orders_enqueue_emails;

  update public.promos p set times_used = (select count(*) from public.promo_redemptions r where r.promo_id = p.id) where p.id in (promo_pct, promo_fixed);

  -- Three paid catering requests (paid in the past, events still ahead),
  -- written as they end up: no lead-time check, status steps or emails.
  alter table public.catering_requests disable trigger user;
  alter table public.catering_quotes disable trigger user;
  for n in 1..3 loop
    declare
      req uuid := gen_random_uuid();
      quote uuid := gen_random_uuid();
      paid_at timestamptz := now() - make_interval(days => (array[30, 16, 4])[n]);
      v_event_at timestamptz := (public.cafe_today() + (array[6, 12, 20])[n] + time '11:00') at time zone 'Pacific/Honolulu';
      items integer := (array[18000, 26500, 41250])[n];
      ctax integer := ((array[18000, 26500, 41250])[n] * 4712 + 50000) / 100000;
    begin
      insert into public.catering_requests (id, request_number, user_id, contact_name, contact_email, contact_phone, event_at, headcount,
                                            fulfillment, status, location_id, created_at, notes)
      values (req, 'CAT-' || to_char(public.cafe_date(paid_at), 'YYMMDD') || '-9' || lpad(n::text, 2, '0'), users[n], 'Demo Customer ' || n,
              'demo-' || n || '@reports.drincup.test', '(808) 555-0100', v_event_at, (array[20, 30, 45])[n], 'pickup', 'submitted', cafe,
              paid_at - interval '2 days', 'Reports demo catering request');
      insert into public.catering_quotes (id, catering_request_id, version, status, items_subtotal_cents, taxable_cents, tax_rate, tax_cents,
                                          total_cents, expires_at, payment_deadline_at, created_at)
      values (quote, req, 1, 'paid', items, items, 0.04712, ctax, items + ctax, v_event_at - interval '48 hours', v_event_at - interval '48 hours', paid_at - interval '1 day');
      insert into public.catering_quote_lines (quote_id, kind, description, quantity, unit_price_cents, line_total_cents)
      values (quote, 'custom', 'Reports demo: coffee and refreshers service', 1, items, items);
      update public.catering_requests
         set status = 'confirmed', current_quote_id = quote, quoted_at = paid_at - interval '1 day', confirmed_at = paid_at
       where id = req;
      insert into public.payments (catering_request_id, catering_quote_id, provider_payment_intent_id, status, amount_cents, refunded_cents,
                                   method_brand, method_last4, created_at)
      values (req, quote, 'pi_demo_catering_' || n, (case when n = 2 then 'partially_refunded' else 'succeeded' end)::public.payment_status, items + ctax,
              case when n = 2 then 5000 else 0 end, 'visa', '4242', paid_at);
    end;
  end loop;
  alter table public.catering_requests enable trigger user;
  alter table public.catering_quotes enable trigger user;
end
$demo$;
`;

const sql = `begin;\n${CLEANUP}\n${REMOVE ? "" : SEED}\ncommit;\n`;
const result = psql(container, sql);
if (result.error || result.status !== 0) {
  console.error(`Reports demo ${REMOVE ? "removal" : "seed"} failed:\n${result.error?.message ?? result.stderr}`);
  process.exit(1);
}
if (REMOVE) {
  console.log(`Removed the reports demo data from ${container}.`);
} else {
  const counts = psql(
    container,
    "select (select count(*) from public.orders where idempotency_key like 'reports-demo-%') || ' orders, ' || (select count(*) from public.catering_requests where contact_email like '%@reports.drincup.test') || ' catering requests';",
  );
  console.log(`Reports demo data in ${container}: ${counts.stdout.trim()}, over the last six weeks.`);
  console.log("It is clearly fake (DEMO- codes, demo-*@reports.drincup.test, order numbers ending 9NNN). Remove it with: npm run db:seed:reports-demo -- --remove");
}

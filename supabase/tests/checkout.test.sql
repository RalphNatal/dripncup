-- ============================================================================
-- Checkout and payments in the database: who may create and read orders, the
-- idempotent order creation, the webhook's state changes (placed, rejected,
-- flagged, replayed, refunded) and the dedupe and rate-limit tables. The
-- HTTP side is covered by e2e/webhooks.spec.ts and e2e/checkout.spec.ts.
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(50);

create function pg_temp.try_as(role_name text, sql text)
returns text
language plpgsql
as $$
begin
  execute format('set local role %I', role_name);
  execute sql;
  reset role;
  return 'ok';
exception
  when others then
    return sqlstate;
end;
$$;

create function pg_temp.sqlstate_of(sql text)
returns text
language plpgsql
as $$
begin
  execute sql;
  return 'ok';
exception
  when others then
    return sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--   c1...01  the buyer        c1...02  another customer
--   11...01  a cafe           21...01  a product      51...01  a promo
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000001', 'buyer@drincup.test', '{"full_name": "Kai Buyer"}'),
  ('c1000000-0000-0000-0000-000000000002', 'other@drincup.test', '{"full_name": "Noe Other"}');

insert into public.locations (id, type, name, slug)
values ('11000000-0000-0000-0000-000000000001', 'cafe', 'Checkout Test Cafe', 'checkout-test-cafe');

insert into public.products (id, name, slug, base_price_cents)
values ('21000000-0000-0000-0000-000000000001', 'Test Drip', 'test-drip-checkout', 500);

insert into public.promos (id, code, type, percent)
values ('51000000-0000-0000-0000-000000000001', 'PGTAP10', 'percent', 10);

-- What createCheckout sends create_checkout_order.
create function pg_temp.order_json(p_key text, p_total integer, p_promo uuid default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'user_id', 'c1000000-0000-0000-0000-000000000001',
    'location_id', '11000000-0000-0000-0000-000000000001',
    'pickup_type', 'asap',
    'scheduled_for', null,
    'estimated_ready_at', now() + interval '10 minutes',
    'subtotal_cents', p_total, 'discount_cents', 0, 'taxable_base_cents', p_total,
    'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', p_total,
    'promo_id', p_promo, 'promo_code', case when p_promo is null then null else 'PGTAP10' end,
    'customer_first_name', 'Kai', 'customer_phone', null, 'customer_email', 'buyer@drincup.test',
    'notes', null, 'idempotency_key', p_key, 'checkout_fingerprint', 'fp-' || p_key
  );
$$;

create function pg_temp.items_json()
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'product_id', '21000000-0000-0000-0000-000000000001', 'product_size_id', null,
    'product_name', 'Test Drip', 'size_name', null, 'modifiers', '[]'::jsonb,
    'base_price_cents', 500, 'unit_price_cents', 500, 'quantity', 1, 'line_total_cents', 500,
    'special_instructions', ''
  ));
$$;

create function pg_temp.order_id(p_key text)
returns uuid
language sql
as $$ select id from public.orders where idempotency_key = p_key $$;

-- ---------------------------------------------------------------------------
-- Only the service role creates orders or runs the payment functions.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role": "authenticated", "sub": "c1000000-0000-0000-0000-000000000001"}';

select is(
  pg_temp.try_as('authenticated', $$
    insert into public.orders (user_id, location_id, idempotency_key)
    values ('c1000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'pgtap-direct')
  $$),
  '42501',
  'a customer cannot insert an order directly'
);
select is(
  pg_temp.try_as('authenticated', $$select public.create_checkout_order(pg_temp.order_json('pgtap-x', 500), pg_temp.items_json())$$),
  '42501',
  'a customer cannot call create_checkout_order'
);
select is(
  pg_temp.try_as('anon', $$select public.create_checkout_order(pg_temp.order_json('pgtap-x', 500), pg_temp.items_json())$$),
  '42501',
  'a guest cannot call create_checkout_order'
);
select is(
  pg_temp.try_as('authenticated', $$select public.mark_order_paid(gen_random_uuid(), 'pi_x', '', 500, 'usd')$$),
  '42501',
  'a customer cannot mark an order paid'
);
select is(
  pg_temp.try_as('authenticated', $$select public.record_payment_failure('pi_x', 'x', 'x')$$),
  '42501',
  'a customer cannot record a payment failure'
);
select is(
  pg_temp.try_as('authenticated', $$select public.apply_refund_state('pi_x', 1)$$),
  '42501',
  'a customer cannot record a refund'
);
select is(
  pg_temp.try_as('authenticated', $$select public.get_promo_for_checkout('PGTAP10', 'c1000000-0000-0000-0000-000000000001')$$),
  '42501',
  'a customer cannot read promo rules through the checkout lookup'
);
select is(
  pg_temp.try_as('authenticated', $$select public.rate_limit_hit('x', 1, 60)$$),
  '42501',
  'a customer cannot touch the rate limiter'
);
select is(
  pg_temp.try_as('authenticated', $$update public.orders set status = 'placed' where user_id = auth.uid()$$),
  '42501',
  'a customer cannot update their own order (no UPDATE privilege)'
);

reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- create_checkout_order: one order per idempotency key.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.try_as('service_role', $$
    select public.create_checkout_order(
      pg_temp.order_json('pgtap-a', 612, '51000000-0000-0000-0000-000000000001'), pg_temp.items_json())
  $$),
  'ok',
  'the service role creates the order'
);
select is(
  (select created from public.create_checkout_order(
     pg_temp.order_json('pgtap-a', 612, '51000000-0000-0000-0000-000000000001'), pg_temp.items_json())),
  false,
  'the same key again creates nothing'
);
select is(
  (select order_id from public.create_checkout_order(pg_temp.order_json('pgtap-a', 612), pg_temp.items_json())),
  pg_temp.order_id('pgtap-a'),
  '... and returns the first order'
);
select is(
  (select count(*)::int from public.order_items where order_id = pg_temp.order_id('pgtap-a')),
  1,
  '... without duplicating its lines'
);
select is(
  (select status::text from public.orders where id = pg_temp.order_id('pgtap-a')),
  'pending_payment',
  'a new order waits for payment'
);

-- Four more: mismatch, rejected, cancelled-first, and one left pending.
select public.create_checkout_order(pg_temp.order_json(k, 500), pg_temp.items_json())
  from unnest(array['pgtap-b', 'pgtap-c', 'pgtap-d']) as k;
select public.create_checkout_order(
  pg_temp.order_json('pgtap-e', 500, '51000000-0000-0000-0000-000000000001'), pg_temp.items_json());

insert into public.payments (order_id, provider_payment_intent_id, status, amount_cents)
select pg_temp.order_id('pgtap-' || k), 'pi_pgtap_' || k, 'requires_payment', o.total_cents
  from unnest(array['a', 'b', 'c', 'd']) as k
  join public.orders o on o.idempotency_key = 'pgtap-' || k;

-- ---------------------------------------------------------------------------
-- mark_order_paid.
-- ---------------------------------------------------------------------------
select is(
  public.mark_order_paid(pg_temp.order_id('pgtap-a'), 'pi_pgtap_a', 'ch_pgtap_a', 612, 'usd'),
  'placed',
  'a matching payment places the order'
);
select ok(
  (select status = 'placed' and placed_at is not null from public.orders where idempotency_key = 'pgtap-a'),
  '... Placed, with placed_at stamped'
);
select is(
  (select status || ' ' || provider_charge_id from public.payments where provider_payment_intent_id = 'pi_pgtap_a'),
  'succeeded ch_pgtap_a',
  '... and the payment recorded with its charge'
);
select is(
  (select times_used from public.promos where id = '51000000-0000-0000-0000-000000000001'),
  1,
  '... and the promo counted'
);
select is(
  public.mark_order_paid(pg_temp.order_id('pgtap-a'), 'pi_pgtap_a', 'ch_pgtap_a', 612, 'usd'),
  'already_placed',
  'a replayed success changes nothing'
);
select is(
  (select count(*)::int from public.promo_redemptions where order_id = pg_temp.order_id('pgtap-a')),
  1,
  '... the redemption is recorded once'
);
select is(
  (select times_used from public.promos where id = '51000000-0000-0000-0000-000000000001'),
  1,
  '... and counted once'
);
select is(
  public.record_payment_failure('pi_pgtap_a', 'card_declined', 'late'),
  false,
  'a late failure event is ignored'
);
select is(
  (select status from public.payments where provider_payment_intent_id = 'pi_pgtap_a'),
  'succeeded',
  '... and never undoes the success'
);

select is(
  public.mark_order_paid(pg_temp.order_id('pgtap-b'), 'pi_pgtap_b', '', 450, 'usd'),
  'amount_mismatch',
  'a payment for the wrong amount is not accepted'
);
select ok(
  (select status = 'pending_payment' and flagged_for_review_at is not null
          and review_reason like 'Payment of 450 usd%'
     from public.orders where idempotency_key = 'pgtap-b'),
  '... the order stays unplaced and is flagged for review'
);

select is(
  public.mark_order_paid(pg_temp.order_id('pgtap-c'), 'pi_pgtap_c', '', 500, 'usd', null,
                         'Checkout Test Cafe has paused online orders.'),
  'rejected',
  'a payment after the location paused is rejected'
);
select is(
  (select status || ': ' || cancellation_reason from public.orders where idempotency_key = 'pgtap-c'),
  'cancelled: Checkout Test Cafe has paused online orders.',
  '... the order is cancelled with the reason the customer sees'
);
select is(
  (select status from public.payments where provider_payment_intent_id = 'pi_pgtap_c'),
  'succeeded',
  '... and the money is recorded, for the refund'
);

update public.orders set status = 'cancelled', cancellation_reason = 'Checkout expired'
 where idempotency_key = 'pgtap-d';
select is(
  public.mark_order_paid(pg_temp.order_id('pgtap-d'), 'pi_pgtap_d', '', 500, 'usd'),
  'not_pending',
  'a payment for an order already cancelled is reported, not placed'
);
select is(
  public.mark_order_paid(gen_random_uuid(), 'pi_nobody', '', 500, 'usd'),
  'unknown_order',
  'a payment for no known order is reported'
);

-- ---------------------------------------------------------------------------
-- record_payment_failure and apply_refund_state.
-- ---------------------------------------------------------------------------
insert into public.payments (order_id, provider_payment_intent_id, status, amount_cents)
values (pg_temp.order_id('pgtap-e'), 'pi_pgtap_e', 'requires_payment', 500);
select is(
  public.record_payment_failure('pi_pgtap_e', 'card_declined', 'Your card was declined.'),
  true,
  'a failed attempt is recorded'
);
select is(
  (select status || ' ' || failure_code from public.payments where provider_payment_intent_id = 'pi_pgtap_e'),
  'failed card_declined',
  '... on the payment'
);
select is(
  (select status::text from public.orders where idempotency_key = 'pgtap-e'),
  'pending_payment',
  '... while the order stays open for a retry'
);

select is(public.apply_refund_state('pi_pgtap_a', 200), 'placed', 'a partial refund leaves the order running');
select is(
  (select status || ' ' || refunded_cents from public.payments where provider_payment_intent_id = 'pi_pgtap_a'),
  'partially_refunded 200',
  '... and is recorded on the payment'
);
select is(
  (select refunded_cents from public.payments
     where provider_payment_intent_id = 'pi_pgtap_a' and public.apply_refund_state('pi_pgtap_a', 100) is not null),
  200,
  'an older, smaller refund total never lowers it'
);
select is(public.apply_refund_state('pi_pgtap_a', 612, 'Refunded by the cafe'), 'refunded', 'a full refund ends the order');
select is(
  (select cancellation_reason from public.orders where idempotency_key = 'pgtap-a'),
  'Refunded by the cafe',
  '... with the reason kept'
);

-- ---------------------------------------------------------------------------
-- Customers read only their own orders, lines, payments and refunds.
-- ---------------------------------------------------------------------------
insert into public.refunds (order_id, payment_id, amount_cents, reason, status)
select o.id, p.id, 612, 'Refunded by the cafe', 'succeeded'
  from public.orders o join public.payments p on p.order_id = o.id
 where o.idempotency_key = 'pgtap-a';

set local request.jwt.claims to '{"role": "authenticated", "sub": "c1000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select is(
  (select count(*)::int from public.orders where idempotency_key like 'pgtap-%'),
  5,
  'the buyer sees their own orders'
);
select is(
  (select count(*)::int from public.refunds r join public.orders o on o.id = r.order_id where o.idempotency_key = 'pgtap-a'),
  1,
  '... and the refund on one'
);
reset role;

set local request.jwt.claims to '{"role": "authenticated", "sub": "c1000000-0000-0000-0000-000000000002"}';
set local role authenticated;
select is(
  (select count(*)::int from public.orders where idempotency_key like 'pgtap-%'),
  0,
  'another customer sees none of them'
);
select is(
  (select count(*)::int from public.order_items where product_name = 'Test Drip'),
  0,
  '... nor their lines'
);
select is(
  (select count(*)::int from public.payments where provider_payment_intent_id like 'pi_pgtap_%'),
  0,
  '... nor their payments'
);
select is((select count(*)::int from public.refunds), 0, '... nor their refunds');
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- The promo lookup, the webhook log and the rate limiter.
-- ---------------------------------------------------------------------------
select is(
  (select public.get_promo_for_checkout('  pgtap10 ', 'c1000000-0000-0000-0000-000000000001') ->> 'code'),
  'PGTAP10',
  'promo codes match ignoring case and spaces'
);
select is(
  (select (public.get_promo_for_checkout('PGTAP10', 'c1000000-0000-0000-0000-000000000001') ->> 'user_uses')::int),
  2,
  'a customer''s uses count paid redemptions and other unpaid checkouts'
);
select is(
  (select (public.get_promo_for_checkout('PGTAP10', 'c1000000-0000-0000-0000-000000000001', 'pgtap-e') ->> 'user_uses')::int),
  1,
  '... but not the checkout being retried'
);

insert into public.webhook_events (id, type) values ('evt_pgtap_1', 'payment.succeeded');
select is(
  pg_temp.sqlstate_of($$insert into public.webhook_events (id, type) values ('evt_pgtap_1', 'payment.succeeded')$$),
  '23505',
  'an event id can only be logged once'
);
set local request.jwt.claims to '{"role": "authenticated", "sub": "c1000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select is((select count(*)::int from public.webhook_events), 0, 'customers cannot read the webhook log');
reset role;
reset request.jwt.claims;

select is(
  array[
    public.rate_limit_hit('pgtap:key', 2, 600),
    public.rate_limit_hit('pgtap:key', 2, 600),
    public.rate_limit_hit('pgtap:key', 2, 600),
    public.rate_limit_hit('pgtap:key', 2, 600, 0),
    public.rate_limit_hit('pgtap:other', 2, 600)
  ],
  array[true, true, false, false, true],
  'the limiter allows the limit, refuses the next, peeks without counting, and keeps keys apart'
);

select * from finish();
rollback;

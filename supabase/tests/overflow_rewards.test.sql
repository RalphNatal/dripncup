-- ============================================================================
-- Overflow Rewards in the database: who may write the ledger (nobody but the
-- SQL functions), reservations at checkout, the points lifecycle through
-- payment, pickup, partial and full refunds and cancellation, replays,
-- negative balances, free orders, member lookup, admin adjustments, expiry
-- and account deletion. Concurrent double-spending is proven with two real
-- sessions in points_race.concurrent.mjs.
--
-- The refund numbers (12 points on a $13.00 payment: $5 -> 4, $10 -> 9,
-- all -> 12) are the same cases as pointsToReverse in
-- src/lib/pricing/points.test.ts, so the SQL and TypeScript agree.
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(76);

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
    reset role;
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
--   c7...01 the buyer (Kai)   c7...02 another customer
--   c7...03 a barista         c7...04 an admin
--   17...01 a cafe            27...01 a product        37...01 a reward
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c7000000-0000-0000-0000-000000000001', 'kai@drincup.test', '{"full_name": "Kai Points"}'),
  ('c7000000-0000-0000-0000-000000000002', 'noe@drincup.test', '{"full_name": "Noe Other"}'),
  ('c7000000-0000-0000-0000-000000000003', 'barista7@drincup.test', '{"full_name": "Lani Barista"}'),
  ('c7000000-0000-0000-0000-000000000004', 'admin7@drincup.test', '{"full_name": "Alika Admin"}');

update public.profiles set role = 'staff' where id = 'c7000000-0000-0000-0000-000000000003';
update public.profiles set role = 'admin' where id = 'c7000000-0000-0000-0000-000000000004';

insert into public.locations (id, type, name, slug)
values ('17000000-0000-0000-0000-000000000001', 'cafe', 'Rewards Test Cafe', 'rewards-test-cafe');
insert into public.staff_locations (profile_id, location_id)
values ('c7000000-0000-0000-0000-000000000003', '17000000-0000-0000-0000-000000000001');

insert into public.products (id, name, slug, base_price_cents)
values ('27000000-0000-0000-0000-000000000001', 'Test Latte', 'test-latte-rewards', 900);

insert into public.rewards (id, name, type, points_cost, value_cents)
values ('37000000-0000-0000-0000-000000000001', 'Free drink', 'free_item', 150, 750);

-- What createCheckout sends: subtotal - reward = total (no tax or tip here).
create function pg_temp.order_json(p_key text, p_total integer, p_points integer, p_reward_cents integer, p_earn integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'user_id', 'c7000000-0000-0000-0000-000000000001',
    'location_id', '17000000-0000-0000-0000-000000000001',
    'pickup_type', 'asap',
    'estimated_ready_at', now() + interval '10 minutes',
    'subtotal_cents', p_total + p_reward_cents, 'discount_cents', p_reward_cents,
    'reward_discount_cents', p_reward_cents, 'taxable_base_cents', p_total,
    'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', p_total,
    'points_earned', p_earn, 'points_redeemed', p_points,
    'customer_first_name', 'Kai', 'idempotency_key', p_key, 'checkout_fingerprint', 'fp-' || p_key
  );
$$;

create function pg_temp.item_id(p_key text)
returns uuid
language sql
immutable
as $$ select md5('item-' || p_key)::uuid $$;

create function pg_temp.items_json(p_key text, p_line integer)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'id', pg_temp.item_id(p_key),
    'product_id', '27000000-0000-0000-0000-000000000001', 'product_name', 'Test Latte', 'modifiers', '[]'::jsonb,
    'base_price_cents', p_line, 'unit_price_cents', p_line, 'quantity', 1, 'line_total_cents', p_line,
    'special_instructions', ''
  ));
$$;

create function pg_temp.rewards_json(p_key text, p_points integer, p_cents integer)
returns jsonb
language sql
as $$
  select case when p_points = 0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
    'reward_id', '37000000-0000-0000-0000-000000000001', 'reward_name', 'Free drink', 'reward_type', 'free_item',
    'points_cost', p_points, 'discount_cents', p_cents, 'order_item_id', pg_temp.item_id(p_key), 'option_name', null
  )) end;
$$;

-- A checkout: the order, its line and (optionally) a reward.
create function pg_temp.checkout(p_key text, p_total integer, p_points integer, p_reward_cents integer, p_earn integer default 0)
returns uuid
language sql
as $$
  select order_id from public.create_checkout_order(
    pg_temp.order_json(p_key, p_total, p_points, p_reward_cents, p_earn),
    pg_temp.items_json(p_key, p_total + p_reward_cents),
    pg_temp.rewards_json(p_key, p_points, p_reward_cents)
  );
$$;

create function pg_temp.order_id(p_key text)
returns uuid
language sql
as $$ select id from public.orders where idempotency_key = p_key $$;

-- The webhook's success path.
create function pg_temp.pay(p_key text)
returns text
language sql
as $$
  insert into public.payments (order_id, provider_payment_intent_id, status, amount_cents)
  select id, 'pi_' || p_key, 'requires_payment', total_cents from public.orders where idempotency_key = p_key;
  select public.mark_order_paid(pg_temp.order_id(p_key), 'pi_' || p_key, 'ch_' || p_key,
                                (select total_cents from public.orders where idempotency_key = p_key), 'usd');
$$;

create function pg_temp.pick_up(p_key text)
returns void
language sql
as $$
  update public.orders set status = 'accepted' where idempotency_key = p_key;
  update public.orders set status = 'preparing' where idempotency_key = p_key;
  update public.orders set status = 'ready' where idempotency_key = p_key;
  update public.orders set status = 'picked_up' where idempotency_key = p_key;
$$;

create function pg_temp.balance()
returns integer
language sql
as $$ select loyalty_points from public.profiles where id = 'c7000000-0000-0000-0000-000000000001' $$;

create function pg_temp.ledger(p_key text, p_type public.loyalty_transaction_type)
returns integer
language sql
as $$
  select coalesce(sum(points), 0)::integer from public.loyalty_transactions
   where order_id = pg_temp.order_id(p_key) and type = p_type;
$$;

create function pg_temp.reservation(p_key text)
returns text
language sql
as $$ select status from public.loyalty_reservations where order_id = pg_temp.order_id(p_key) $$;

-- ---------------------------------------------------------------------------
-- Nobody writes the ledger, the reservations or order_rewards directly.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000001"}';

select is(
  pg_temp.try_as('authenticated', $$
    insert into public.loyalty_transactions (user_id, type, points, description)
    values ('c7000000-0000-0000-0000-000000000001', 'adjust', 1000, 'free points please')
  $$),
  '42501',
  'a customer cannot add points to the ledger'
);
select is(
  pg_temp.try_as('authenticated', $$update public.loyalty_transactions set points = 1000 where user_id = auth.uid()$$),
  '42501',
  'a customer cannot edit ledger rows'
);
select is(
  pg_temp.try_as('authenticated', $$delete from public.loyalty_transactions where user_id = auth.uid() and points < 0$$),
  '42501',
  'a customer cannot delete ledger rows'
);
select is(
  pg_temp.try_as('authenticated', $$
    insert into public.loyalty_reservations (user_id, order_id, points)
    values ('c7000000-0000-0000-0000-000000000001', gen_random_uuid(), 1)
  $$),
  '42501',
  'a customer cannot create a reservation'
);
select is(
  pg_temp.try_as('authenticated', $$update public.loyalty_reservations set status = 'released' where user_id = auth.uid()$$),
  '42501',
  'a customer cannot release their own reservation'
);
select is(
  pg_temp.try_as('authenticated', $$
    insert into public.order_rewards (order_id, reward_name, reward_type, points_cost, discount_cents)
    values (gen_random_uuid(), 'x', 'amount_off', 1, 1000)
  $$),
  '42501',
  'a customer cannot attach a reward to an order'
);
select is(
  pg_temp.try_as('authenticated', $$select public.sync_order_loyalty(gen_random_uuid())$$),
  '42501',
  'a customer cannot run the loyalty sync'
);
select is(
  pg_temp.try_as('authenticated', $$select public.place_free_order(gen_random_uuid())$$),
  '42501',
  'a customer cannot place an order for free'
);
select is(
  pg_temp.try_as('authenticated', $$select public.expire_loyalty_points()$$),
  '42501',
  'a customer cannot run the expiry job'
);

set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000004"}';
select is(
  pg_temp.try_as('authenticated', $$
    insert into public.loyalty_transactions (user_id, type, points, description)
    values ('c7000000-0000-0000-0000-000000000001', 'adjust', 10, 'direct insert')
  $$),
  '42501',
  'even an admin cannot write the ledger directly (adjustments go through the function)'
);

-- ---------------------------------------------------------------------------
-- Admin adjustments: a reason, an actor, admins only.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000001"}';
select is(
  pg_temp.try_as('authenticated', $$select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', 500, 'I deserve it')$$),
  '42501',
  'a customer cannot adjust points'
);
reset request.jwt.claims;
select is(
  pg_temp.try_as('anon', $$select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', 500, 'guest')$$),
  '42501',
  'a guest cannot adjust points'
);

set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000004"}';
select is(
  pg_temp.try_as('authenticated', $$select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', 200, '  ')$$),
  '22023',
  'an adjustment needs a reason'
);
select is(
  pg_temp.try_as('authenticated', $$select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', 0, 'Nothing')$$),
  '22023',
  'an adjustment cannot be zero points'
);
select is(
  pg_temp.try_as('authenticated', $$select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', 200, 'Welcome bonus')$$),
  'ok',
  'an admin adjusts points with a reason'
);
select is(
  (select created_by from public.loyalty_transactions
    where user_id = 'c7000000-0000-0000-0000-000000000001' and description = 'Welcome bonus'),
  'c7000000-0000-0000-0000-000000000004'::uuid,
  '... and is recorded as the one who made it'
);

-- Studio's SQL editor: no signed-in user, no API role.
reset request.jwt.claims;
select is(
  pg_temp.sqlstate_of($$select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', -50, 'Correction from Studio')$$),
  'ok',
  'a direct database session (Studio) can adjust points too'
);
select is(pg_temp.balance(), 150, 'the cached balance follows the ledger: 200 - 50');

-- Customers read only their own ledger.
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000002"}';
set local role authenticated;
select is(
  (select count(*)::int from public.loyalty_transactions where user_id = 'c7000000-0000-0000-0000-000000000001'),
  0,
  'another customer cannot read the buyer''s ledger'
);
reset role;
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select is(
  (select count(*)::int from public.loyalty_transactions where user_id = 'c7000000-0000-0000-0000-000000000001'),
  2,
  'the buyer reads their own ledger'
);
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Checkout reserves the points, in the same transaction as the order.
-- ---------------------------------------------------------------------------
select isnt(pg_temp.checkout('rw-a', 1300, 150, 500, 12), null, 'a checkout with a free drink is created');
select is(pg_temp.reservation('rw-a'), 'held', '... holding its points');
select is(pg_temp.balance(), 0, '... which are already off the balance');
select is(pg_temp.ledger('rw-a', 'redeem'), -150, '... through one redeem entry');
select is(
  (select order_item_id from public.order_rewards where order_id = pg_temp.order_id('rw-a')),
  pg_temp.item_id('rw-a'),
  '... and the reward is recorded on its line'
);

select is(
  pg_temp.sqlstate_of($$select pg_temp.checkout('rw-b', 1300, 150, 500, 12)$$),
  'DC004',
  'a second checkout cannot spend the same points'
);
select is(pg_temp.order_id('rw-b'), null, '... and leaves no order behind');

select is(
  pg_temp.sqlstate_of($$
    select public.create_checkout_order(
      pg_temp.order_json('rw-bad', 1300, 150, 500, 0), pg_temp.items_json('rw-bad', 1800),
      pg_temp.rewards_json('rw-bad', 100, 500))
  $$),
  '22023',
  'the rewards must account for exactly the points on the order'
);
select is(
  (select created from public.create_checkout_order(
     pg_temp.order_json('rw-a', 1300, 150, 500, 12), pg_temp.items_json('rw-a', 1800), pg_temp.rewards_json('rw-a', 150, 500))),
  false,
  'retrying the same checkout creates nothing'
);
select is(
  (select count(*)::int from public.loyalty_reservations where order_id = pg_temp.order_id('rw-a')),
  1,
  '... and reserves nothing more'
);

set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select is(
  (select kind from public.list_my_points_activity() where order_id = pg_temp.order_id('rw-a')),
  'reserved',
  'the activity log shows the points as reserved until payment'
);
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Payment turns the hold into a redemption; a replay changes nothing.
-- ---------------------------------------------------------------------------
select is(pg_temp.pay('rw-a'), 'placed', 'the payment places the order');
select is(pg_temp.reservation('rw-a'), 'redeemed', '... and the reservation becomes a redemption');
select is(
  public.mark_order_paid(pg_temp.order_id('rw-a'), 'pi_rw-a', 'ch_rw-a', 1300, 'usd'),
  'already_placed',
  'a replayed payment event is recognised'
);
select is(
  (select count(*)::int from public.loyalty_transactions where order_id = pg_temp.order_id('rw-a')),
  1,
  '... and neither redeems nor returns points again'
);

set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000001"}';
set local role authenticated;
select is(
  (select kind from public.list_my_points_activity() where order_id = pg_temp.order_id('rw-a') limit 1),
  'redeemed',
  'the activity log now shows the points as redeemed'
);
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Pickup earns, once.
-- ---------------------------------------------------------------------------
select is(pg_temp.ledger('rw-a', 'earn'), 0, 'nothing is earned before pickup');
select pg_temp.pick_up('rw-a');
select is(pg_temp.ledger('rw-a', 'earn'), 12, 'pickup credits the points worked out at checkout');
select public.sync_order_loyalty(pg_temp.order_id('rw-a'));
select is(
  (select count(*)::int from public.loyalty_transactions where order_id = pg_temp.order_id('rw-a') and type = 'earn'),
  1,
  'running the sync again does not credit twice'
);
select is(pg_temp.balance(), 12, 'balance after pickup');

-- ---------------------------------------------------------------------------
-- Refunds after pickup reverse in proportion; a full refund returns the
-- redeemed points too. Same cases as pointsToReverse.
-- ---------------------------------------------------------------------------
select public.apply_refund_state('pi_rw-a', 500, 'Wrong milk');
select is(pg_temp.ledger('rw-a', 'reverse'), -4, 'a $5.00 refund of $13.00 reverses 4 of 12 points (rounded down)');
select is(pg_temp.reservation('rw-a'), 'redeemed', '... and a partial refund does not return the redeemed points');
select public.apply_refund_state('pi_rw-a', 500, 'Wrong milk');
select is(pg_temp.ledger('rw-a', 'reverse'), -4, 'a replayed refund reverses nothing more');
select public.apply_refund_state('pi_rw-a', 1000, 'More wrong milk');
select is(pg_temp.ledger('rw-a', 'reverse'), -9, 'a further refund to $10.00 tops the reversal up to 9');
select is(public.apply_refund_state('pi_rw-a', 1300, 'Refund the rest'), 'refunded', 'refunding the rest refunds the order');
select is(pg_temp.ledger('rw-a', 'reverse'), -12, '... reversing every earned point');
select is(pg_temp.reservation('rw-a'), 'released', '... and returning the redeemed points');
select public.apply_refund_state('pi_rw-a', 1300, 'Refund the rest');
select is(pg_temp.ledger('rw-a', 'release'), 150, 'a replayed full refund returns them only once');
select is(pg_temp.balance(), 150, 'balance after the full refund: 12 - 12 + 150');

-- ---------------------------------------------------------------------------
-- Cancelled before pickup: points back, nothing earned.
-- ---------------------------------------------------------------------------
select pg_temp.checkout('rw-c', 1300, 150, 500, 12);
update public.orders set status = 'cancelled', cancellation_reason = 'Checkout expired before the payment was completed.'
 where idempotency_key = 'rw-c';
select is(pg_temp.reservation('rw-c'), 'released', 'an expired checkout releases its reservation');
select is(pg_temp.balance(), 150, '... and the points are back');
select is(pg_temp.ledger('rw-c', 'earn'), 0, '... and nothing is earned');

-- ---------------------------------------------------------------------------
-- Negative balances: a refund after the points were spent.
-- ---------------------------------------------------------------------------
select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', -150, 'Reset for the test');
select pg_temp.checkout('rw-d', 2000, 0, 0, 20);
select pg_temp.pay('rw-d');
select pg_temp.pick_up('rw-d');
select pg_temp.checkout('rw-e', 1000, 20, 400, 0);
select pg_temp.pay('rw-e');
select is(pg_temp.balance(), 0, 'the 20 points from one order were spent on another');
select public.apply_refund_state('pi_rw-d', 2000, 'Refunded in full');
select is(pg_temp.balance(), -20, 'refunding the first order takes the balance below zero, keeping the ledger exact');
select is(
  pg_temp.sqlstate_of($$select pg_temp.checkout('rw-neg', 1000, 10, 100, 0)$$),
  'DC004',
  'a negative balance cannot redeem anything'
);

-- ---------------------------------------------------------------------------
-- A reward that pays for everything: placed without a payment.
-- ---------------------------------------------------------------------------
select public.admin_adjust_points('c7000000-0000-0000-0000-000000000001', 200, 'Back in credit');
select pg_temp.checkout('rw-f', 0, 150, 900, 0);
select is(public.place_free_order(pg_temp.order_id('rw-f')), 'placed', 'a $0.00 order is placed straight away');
select is(pg_temp.reservation('rw-f'), 'redeemed', '... redeeming its points');
select pg_temp.checkout('rw-g', 500, 0, 0, 5);
select is(public.place_free_order(pg_temp.order_id('rw-g')), 'not_free', 'an order that costs money cannot be placed that way');

-- ---------------------------------------------------------------------------
-- Staff see the reward on tickets at their counter; nobody else does.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000003"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_rewards where order_id = pg_temp.order_id('rw-f')),
  1,
  'the barista at that counter sees the reward on the order'
);
reset role;
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000002"}';
set local role authenticated;
select is(
  (select count(*)::int from public.order_rewards where order_id = pg_temp.order_id('rw-f')),
  0,
  'another customer does not'
);
reset role;

-- ---------------------------------------------------------------------------
-- Member lookup: staff only, first name and balance only.
-- ---------------------------------------------------------------------------
create temporary table member_code_before as
  select member_code from public.profiles where id = 'c7000000-0000-0000-0000-000000000001';
grant select on member_code_before to authenticated, anon;

set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000003"}';
set local role authenticated;
select is(
  (select to_jsonb(m) from public.staff_lookup_member((select member_code from member_code_before)) m),
  jsonb_build_object('first_name', 'Kai', 'points', 30),
  'staff get the member''s first name and balance, and nothing else'
);
select is(
  (select points from public.staff_lookup_member(
     lower(regexp_replace((select member_code from member_code_before), '(.{4})', '\1-', 'g')))),
  30,
  '... whether the code is typed in lower case or with dashes'
);
select is(
  (select count(*)::int from public.staff_lookup_member('ZZZZZZZZZZZZ')),
  0,
  'an unknown code finds nobody'
);
reset role;

set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000002"}';
select is(
  pg_temp.try_as('authenticated', $$select * from public.staff_lookup_member((select member_code from member_code_before))$$),
  '42501',
  'a customer cannot look members up'
);
reset request.jwt.claims;
select is(
  pg_temp.try_as('anon', $$select * from public.staff_lookup_member((select member_code from member_code_before))$$),
  '42501',
  'a guest cannot look members up'
);

-- Regenerating retires the old code.
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000001"}';
select is(pg_temp.try_as('authenticated', $$select public.regenerate_member_code()$$), 'ok', 'the buyer regenerates their member code');
reset request.jwt.claims;
select ok(
  (select member_code <> (select member_code from member_code_before) and member_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'
     from public.profiles where id = 'c7000000-0000-0000-0000-000000000001'),
  '... getting a new, well-formed code'
);
set local request.jwt.claims to '{"role": "authenticated", "sub": "c7000000-0000-0000-0000-000000000003"}';
set local role authenticated;
select is(
  (select count(*)::int from public.staff_lookup_member((select member_code from member_code_before))),
  0,
  '... and the old code no longer finds them'
);
reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- The ledger is append-only, even for the database owner.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.sqlstate_of($$update public.loyalty_transactions set points = 999 where user_id = 'c7000000-0000-0000-0000-000000000001'$$),
  '23514',
  'ledger rows cannot be edited'
);
select is(
  pg_temp.sqlstate_of($$update public.loyalty_transactions set created_by = 'c7000000-0000-0000-0000-000000000003' where created_by is not null$$),
  '23514',
  '... not even to change who made an adjustment'
);

-- The admin who made an adjustment can still be deleted: the entry stays,
-- detached from them.
delete from auth.users where id = 'c7000000-0000-0000-0000-000000000004';
select is(
  (select count(*)::int from public.loyalty_transactions where description = 'Welcome bonus' and created_by is null),
  1,
  'deleting the admin keeps their adjustment, without the link to them'
);

-- ---------------------------------------------------------------------------
-- Expiry: off by default; when switched on, oldest points first, once.
-- ---------------------------------------------------------------------------
insert into public.loyalty_transactions (user_id, type, points, description, created_at) values
  ('c7000000-0000-0000-0000-000000000002', 'earn', 100, 'Old order', now() - interval '2 years'),
  ('c7000000-0000-0000-0000-000000000002', 'adjust', -30, 'Spent recently', now() - interval '1 day');
select is(public.expire_loyalty_points(), 0, 'with expiry off, nothing expires');

update public.settings set value = '12' where key = 'loyalty.points_expire_after_months';
select public.expire_loyalty_points();
select is(
  (select loyalty_points from public.profiles where id = 'c7000000-0000-0000-0000-000000000002'),
  0,
  'with 12-month expiry, the 70 unspent points from two years ago expire'
);
select public.expire_loyalty_points();
select is(
  (select count(*)::int from public.loyalty_transactions where user_id = 'c7000000-0000-0000-0000-000000000002' and type = 'expire'),
  1,
  'running the job again expires nothing more'
);
update public.settings set value = '0' where key = 'loyalty.points_expire_after_months';

-- ---------------------------------------------------------------------------
-- Account deletion with points held by an unpaid checkout.
-- ---------------------------------------------------------------------------
select pg_temp.checkout('rw-h', 1000, 30, 400, 0);
select public.delete_account_data('c7000000-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.loyalty_transactions where user_id = 'c7000000-0000-0000-0000-000000000001')
  + (select count(*)::int from public.loyalty_reservations where user_id = 'c7000000-0000-0000-0000-000000000001'),
  0,
  'account deletion removes every ledger entry and reservation'
);
select is(
  (select status::text || '/' || (user_id is null)::text from public.orders where idempotency_key = 'rw-h'),
  'cancelled/true',
  '... cancelling the unpaid checkout and detaching it'
);

select * from finish();
rollback;

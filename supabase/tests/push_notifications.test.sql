-- ============================================================================
-- Phase 10: push notifications. Subscriptions belong to their customer and
-- are added only by the server; an order turning Ready owes one push, written
-- in the same transaction, and only if its customer has a device.
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(25);

create function pg_temp.try_as(uid uuid, sql text)
returns text
language plpgsql
as $$
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid)::text, true);
    execute 'set local role authenticated';
  end if;
  execute sql;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception
  when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return sqlstate;
end;
$$;

create function pg_temp.count_as(uid uuid, sql text)
returns integer
language plpgsql
as $$
declare
  result integer;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid)::text, true);
  execute 'set local role authenticated';
  execute sql into result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return result;
end;
$$;

-- p10a: customer with a device   p10b: another customer   p10c: no device   p10d: admin
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-00000000000a', 'p10-push-a@drincup.test', '{"full_name": "Kai Push"}'),
  ('f1000000-0000-0000-0000-00000000000b', 'p10-push-b@drincup.test', '{"full_name": "Noe Other"}'),
  ('f1000000-0000-0000-0000-00000000000c', 'p10-push-c@drincup.test', '{"full_name": "Lani None"}'),
  ('f1000000-0000-0000-0000-00000000000d', 'p10-push-admin@drincup.test', '{"full_name": "Ana Admin"}');
update public.profiles set role = 'admin' where id = 'f1000000-0000-0000-0000-00000000000d';

insert into public.locations (id, type, name, slug)
values ('f1100000-0000-0000-0000-000000000001', 'cafe', 'Push Cafe', 'p10-push-cafe');

-- A p256dh key is 87 characters of base64url; auth is 22.
create function pg_temp.save(p_user text, p_endpoint text, p_label text default 'Chrome on Android')
returns uuid
language sql
as $$
  select public.save_push_subscription(p_user::uuid, p_endpoint, repeat('B', 87), repeat('a', 22), p_label)
$$;

-- ---------------------------------------------------------------------------
-- Saving: the server only, and the endpoint must be https.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.try_as('f1000000-0000-0000-0000-00000000000a',
    $$select public.save_push_subscription('f1000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/x', repeat('B', 87), repeat('a', 22), 'x')$$),
  '42501', 'a customer cannot call save_push_subscription (the server checks the endpoint first)');
select is(
  pg_temp.try_as('f1000000-0000-0000-0000-00000000000a',
    $$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('f1000000-0000-0000-0000-00000000000a', 'https://evil.example/x', repeat('B', 87), repeat('a', 22))$$),
  '42501', 'nor insert a subscription directly');

select isnt(pg_temp.save('f1000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/phone-a'), null, 'the server saves a subscription');
select throws_ok(
  $$select pg_temp.save('f1000000-0000-0000-0000-00000000000a', 'http://169.254.169.254/latest/meta-data')$$,
  '23514', null, 'a plain-http endpoint is refused by the table itself (loopback aside, for the e2e stand-in)');
select throws_ok(
  $$select pg_temp.save('f9999999-0000-0000-0000-000000000000', 'https://fcm.googleapis.com/fcm/send/nobody')$$,
  '42501', null, 'an unknown user is refused');

-- ---------------------------------------------------------------------------
-- Same browser, another account: the row moves over, it is never shared.
-- ---------------------------------------------------------------------------
select pg_temp.save('f1000000-0000-0000-0000-00000000000b', 'https://fcm.googleapis.com/fcm/send/shared-tablet');
select pg_temp.save('f1000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/shared-tablet', 'Edge on Windows');
select is(
  (select user_id::text || ' ' || device_label from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/shared-tablet'),
  'f1000000-0000-0000-0000-00000000000a Edge on Windows', 'a known endpoint is taken over by the account now signed in there');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/shared-tablet'), 1, 'still one row');

-- At most ten devices; the oldest goes.
select pg_temp.save('f1000000-0000-0000-0000-00000000000b', 'https://fcm.googleapis.com/fcm/send/b-' || n) from generate_series(1, 12) n;
select is((select count(*)::int from public.push_subscriptions where user_id = 'f1000000-0000-0000-0000-00000000000b'), 10, 'a customer keeps at most ten devices');

-- ---------------------------------------------------------------------------
-- Reading and removing: their own only.
-- ---------------------------------------------------------------------------
select is(pg_temp.count_as('f1000000-0000-0000-0000-00000000000a', 'select count(*) from public.push_subscriptions'), 2, 'a customer sees their own devices');
select is(pg_temp.count_as('f1000000-0000-0000-0000-00000000000c', 'select count(*) from public.push_subscriptions'), 0, 'and nobody else''s');
select is(pg_temp.try_as(null, 'select count(*) from public.push_subscriptions'), '42501', 'guests cannot read them at all');
select is(
  pg_temp.try_as('f1000000-0000-0000-0000-00000000000a',
    $$update public.push_subscriptions set endpoint = 'https://evil.example/x' where user_id = 'f1000000-0000-0000-0000-00000000000a'$$),
  '42501', 'nobody edits a subscription (an endpoint is where our server sends)');
select pg_temp.try_as('f1000000-0000-0000-0000-00000000000c', $$delete from public.push_subscriptions$$);
select is((select count(*)::int from public.push_subscriptions where user_id <> 'f1000000-0000-0000-0000-00000000000c'), 12, 'deleting as someone else removes nothing');
select pg_temp.try_as('f1000000-0000-0000-0000-00000000000a', $$delete from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/shared-tablet'$$);
select is((select count(*)::int from public.push_subscriptions where user_id = 'f1000000-0000-0000-0000-00000000000a'), 1, 'a customer removes their own device');

-- ---------------------------------------------------------------------------
-- The outbox: one push per Ready, only with a device, in the same transaction.
-- ---------------------------------------------------------------------------
create function pg_temp.placed_order(p_key text, p_user text)
returns uuid
language plpgsql
as $$
declare
  new_id uuid;
begin
  select order_id into new_id from public.create_checkout_order(
    jsonb_build_object(
      'user_id', p_user, 'location_id', 'f1100000-0000-0000-0000-000000000001',
      'pickup_type', 'asap', 'subtotal_cents', 600, 'discount_cents', 0, 'taxable_base_cents', 600,
      'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', 600,
      'customer_email', 'p10@drincup.test', 'idempotency_key', p_key
    ),
    '[]'::jsonb
  );
  perform public.mark_order_paid(new_id, 'pi_' || p_key, 'ch_' || p_key, 600, 'usd');
  return new_id;
end;
$$;

create function pg_temp.pushes(p_order uuid)
returns integer
language sql
as $$ select count(*)::int from public.push_outbox where order_id = p_order $$;

create temp table ids (name text primary key, id uuid);
insert into ids values ('a', pg_temp.placed_order('p10-push-a', 'f1000000-0000-0000-0000-00000000000a'));
insert into ids values ('c', pg_temp.placed_order('p10-push-c', 'f1000000-0000-0000-0000-00000000000c'));

update public.orders set status = 'accepted' where id = (select id from ids where name = 'a');
update public.orders set status = 'preparing' where id = (select id from ids where name = 'a');
select is(pg_temp.pushes((select id from ids where name = 'a')), 0, 'nothing is owed before Ready');
update public.orders set status = 'ready' where id = (select id from ids where name = 'a');
select is(pg_temp.pushes((select id from ids where name = 'a')), 1, 'Ready owes one push, written with the status change');
select is(
  (select kind || ':' || status || ':' || dedupe_key from public.push_outbox where order_id = (select id from ids where name = 'a')),
  'order_ready:pending:order_ready:' || (select id from ids where name = 'a'), 'an order-ready push, waiting for the sender');

-- Ready again (an undo, a repeat): never a second push.
update public.orders set status = 'ready' where id = (select id from ids where name = 'a');
select is(pg_temp.pushes((select id from ids where name = 'a')), 1, 'repeating Ready owes nothing more');

update public.orders set status = 'accepted' where id = (select id from ids where name = 'c');
update public.orders set status = 'preparing' where id = (select id from ids where name = 'c');
update public.orders set status = 'ready' where id = (select id from ids where name = 'c');
select is(pg_temp.pushes((select id from ids where name = 'c')), 0, 'a customer with no device is owed no push');

-- The sender claims rows; nobody else can.
select is((select count(*)::int from public.claim_push_outbox(10) where order_id = (select id from ids where name = 'a')), 1, 'the sender claims the push');
select is((select status from public.push_outbox where order_id = (select id from ids where name = 'a')), 'sending', 'claimed rows are marked sending');
select is(
  pg_temp.try_as('f1000000-0000-0000-0000-00000000000a', $$select * from public.claim_push_outbox(10)$$),
  '42501', 'customers cannot claim pushes');
select is(pg_temp.count_as('f1000000-0000-0000-0000-00000000000a', 'select count(*) from public.push_outbox'), 0, 'customers cannot read the outbox');
select is(pg_temp.count_as('f1000000-0000-0000-0000-00000000000d', format('select count(*) from public.push_outbox where order_id = %L', (select id from ids where name = 'a'))), 1, 'admins can');

-- Deleting the account takes the devices with it.
delete from public.profiles where id = 'f1000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.push_subscriptions where user_id = 'f1000000-0000-0000-0000-00000000000b'), 0, 'a deleted profile''s devices go with it');

select * from finish();
rollback;

-- ============================================================================
-- Phase 5: a customer can never receive another customer's order through
-- Supabase Realtime.
--
-- Realtime decides who gets a change with realtime.apply_rls(): for each
-- subscription it re-reads the changed row by primary key *as that
-- subscriber* (their role and JWT claims), so RLS decides. These tests feed
-- it a change to customer A's order, exactly as the WAL reader would, with
-- subscriptions from A, from B (even one aimed straight at A's order id),
-- from a guest, and from staff, and check which subscriptions it delivers to.
-- The e2e suite (e2e/tracking.spec.ts) proves the same over a real socket.
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures: customers A and B, staff rostered here and elsewhere, one order.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b7000000-0000-0000-0000-00000000000a', 'rt-a@drincup.test', '{"full_name": "Kai A"}'),
  ('b7000000-0000-0000-0000-00000000000b', 'rt-b@drincup.test', '{"full_name": "Noe B"}'),
  ('b7000000-0000-0000-0000-00000000000c', 'rt-staff@drincup.test', '{"full_name": "Staff Here"}'),
  ('b7000000-0000-0000-0000-00000000000d', 'rt-elsewhere@drincup.test', '{"full_name": "Staff Elsewhere"}');
update public.profiles set role = 'staff'
 where id in ('b7000000-0000-0000-0000-00000000000c', 'b7000000-0000-0000-0000-00000000000d');

insert into public.locations (id, type, name, slug) values
  ('b1000000-0000-0000-0000-000000000001', 'cafe', 'Realtime Cafe', 'realtime-cafe'),
  ('b1000000-0000-0000-0000-000000000002', 'cafe', 'Other Cafe', 'realtime-other-cafe');
insert into public.staff_locations (profile_id, location_id) values
  ('b7000000-0000-0000-0000-00000000000c', 'b1000000-0000-0000-0000-000000000001'),
  ('b7000000-0000-0000-0000-00000000000d', 'b1000000-0000-0000-0000-000000000002');

insert into public.orders (id, user_id, location_id, status, idempotency_key, placed_at)
values ('b0000000-0000-0000-0000-0000000000a1', 'b7000000-0000-0000-0000-00000000000a',
        'b1000000-0000-0000-0000-000000000001', 'placed', 'rt-a1', now());

-- ---------------------------------------------------------------------------
-- The table is set up for Realtime, with RLS on.
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'),
  'orders is in the supabase_realtime publication');
select is((select relrowsecurity from pg_class where oid = 'public.orders'::regclass), true, 'RLS is on for orders');
select is((select relreplident::text from pg_class where oid = 'public.orders'::regclass), 'f', 'orders has REPLICA IDENTITY FULL');

-- ---------------------------------------------------------------------------
-- Subscriptions, as Realtime stores them when a client joins a channel.
-- ---------------------------------------------------------------------------
create function pg_temp.subscribe(sub uuid, claims jsonb, filters realtime.user_defined_filter[])
returns void
language sql
as $$
  insert into realtime.subscription (subscription_id, entity, filters, claims)
  values (sub, 'public.orders', filters, claims);
$$;

create function pg_temp.claims(uid text)
returns jsonb
language sql
as $$ select jsonb_build_object('role', 'authenticated', 'sub', uid) $$;

-- A, on their own order (the tracker) and on their user id (the active list).
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000a1', pg_temp.claims('b7000000-0000-0000-0000-00000000000a'),
  array[('id', 'eq', 'b0000000-0000-0000-0000-0000000000a1', false)::realtime.user_defined_filter]);
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000a2', pg_temp.claims('b7000000-0000-0000-0000-00000000000a'),
  array[('user_id', 'eq', 'b7000000-0000-0000-0000-00000000000a', false)::realtime.user_defined_filter]);
-- B, aiming straight at A's order id, at A's user id, and at everything.
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000b1', pg_temp.claims('b7000000-0000-0000-0000-00000000000b'),
  array[('id', 'eq', 'b0000000-0000-0000-0000-0000000000a1', false)::realtime.user_defined_filter]);
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000b2', pg_temp.claims('b7000000-0000-0000-0000-00000000000b'),
  array[('user_id', 'eq', 'b7000000-0000-0000-0000-00000000000a', false)::realtime.user_defined_filter]);
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000b3', pg_temp.claims('b7000000-0000-0000-0000-00000000000b'), '{}');
-- A guest with the public anon key.
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000f1', '{"role": "anon"}', '{}');
-- Staff: rostered at this order's location, and at another.
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000c1', pg_temp.claims('b7000000-0000-0000-0000-00000000000c'), '{}');
select pg_temp.subscribe('5b000000-0000-0000-0000-0000000000d1', pg_temp.claims('b7000000-0000-0000-0000-00000000000d'), '{}');

-- The change the WAL reader would hand Realtime when A's order is accepted.
create function pg_temp.order_change()
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'schema', 'public', 'table', 'orders', 'action', 'U', 'timestamp', now(),
    'pk', jsonb_build_array(jsonb_build_object('name', 'id', 'type', 'uuid')),
    'columns', jsonb_build_array(
      jsonb_build_object('name', 'id', 'type', 'uuid', 'value', 'b0000000-0000-0000-0000-0000000000a1'),
      jsonb_build_object('name', 'user_id', 'type', 'uuid', 'value', 'b7000000-0000-0000-0000-00000000000a'),
      jsonb_build_object('name', 'location_id', 'type', 'uuid', 'value', 'b1000000-0000-0000-0000-000000000001'),
      jsonb_build_object('name', 'status', 'type', 'order_status', 'value', 'accepted'),
      jsonb_build_object('name', 'total_cents', 'type', 'int4', 'value', 612)
    ),
    'identity', jsonb_build_array(
      jsonb_build_object('name', 'id', 'type', 'uuid', 'value', 'b0000000-0000-0000-0000-0000000000a1'),
      jsonb_build_object('name', 'status', 'type', 'order_status', 'value', 'placed')
    )
  );
$$;

create temporary table delivered as
  select unnest(subscription_ids) as subscription_id, errors
    from realtime.apply_rls(pg_temp.order_change());

create function pg_temp.receives(sub text)
returns boolean
language sql
as $$ select exists (select 1 from delivered where subscription_id = sub::uuid) $$;

select is((select count(*)::int from delivered where errors <> '{}'), 0, 'Realtime evaluated every subscription without errors');

select ok(pg_temp.receives('5b000000-0000-0000-0000-0000000000a1'), 'A receives the change on their tracker subscription');
select ok(pg_temp.receives('5b000000-0000-0000-0000-0000000000a2'), 'A receives it on their active-orders subscription');
select ok(not pg_temp.receives('5b000000-0000-0000-0000-0000000000b1'), 'B does not receive it, even subscribed to A''s order id');
select ok(not pg_temp.receives('5b000000-0000-0000-0000-0000000000b2'), 'B does not receive it subscribed to A''s user id');
select ok(not pg_temp.receives('5b000000-0000-0000-0000-0000000000b3'), 'B does not receive it subscribed to every order');
select ok(not pg_temp.receives('5b000000-0000-0000-0000-0000000000f1'), 'a guest does not receive it');
select ok(pg_temp.receives('5b000000-0000-0000-0000-0000000000c1'), 'staff rostered at the location receive it (the queue)');
select ok(not pg_temp.receives('5b000000-0000-0000-0000-0000000000d1'), 'staff at another location do not');

-- ---------------------------------------------------------------------------
-- The refetch a Realtime event triggers is covered by the same RLS.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"role": "authenticated", "sub": "b7000000-0000-0000-0000-00000000000b"}';
select is(
  (select count(*)::int from public.orders where id = 'b0000000-0000-0000-0000-0000000000a1')
  + (select count(*)::int from public.order_status_history where order_id = 'b0000000-0000-0000-0000-0000000000a1')
  + (select count(*)::int from public.list_my_orders('active')),
  0, 'B cannot read A''s order, its history, or see it in their order list');
reset role;

set local role authenticated;
set local request.jwt.claims to '{"role": "authenticated", "sub": "b7000000-0000-0000-0000-00000000000a"}';
select is((select count(*)::int from public.list_my_orders('active')), 1, 'A sees their order in their active list');
reset role;

select * from finish();
rollback;

-- ============================================================================
-- Phase 5, Part 0: who may change an order, and how.
--
-- Staff and admins move orders along only through advance_order_status();
-- nobody but the service role writes to orders, order_items or the status
-- history directly. Paid orders are cancelled only by the server's
-- cancel-with-refund flow (cancel_order_for_refund).
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(33);

-- Runs `sql` as `uid` (null = anon), returning 'ok' or the SQLSTATE it failed with.
create function pg_temp.as_user(uid uuid, sql text)
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
    return sqlstate;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--   a5...01 staff at cafe A    a5...02 staff at cafe B    a5...03 admin
--   a5...04 the customer        a5...05 another customer
--   a1...01 cafe A              a1...02 cafe B
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a5000000-0000-0000-0000-000000000001', 'staff-a@drincup.test', '{"full_name": "Staff A"}'),
  ('a5000000-0000-0000-0000-000000000002', 'staff-b@drincup.test', '{"full_name": "Staff B"}'),
  ('a5000000-0000-0000-0000-000000000003', 'admin-x@drincup.test', '{"full_name": "Admin X"}'),
  ('a5000000-0000-0000-0000-000000000004', 'cust-a@drincup.test',  '{"full_name": "Kai Owner"}'),
  ('a5000000-0000-0000-0000-000000000005', 'cust-b@drincup.test',  '{"full_name": "Noe Other"}');

update public.profiles set role = 'staff' where id in ('a5000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000002');
update public.profiles set role = 'admin' where id = 'a5000000-0000-0000-0000-000000000003';

insert into public.locations (id, type, name, slug) values
  ('a1000000-0000-0000-0000-000000000001', 'cafe', 'Status Cafe A', 'status-cafe-a'),
  ('a1000000-0000-0000-0000-000000000002', 'cafe', 'Status Cafe B', 'status-cafe-b');

insert into public.staff_locations (profile_id, location_id) values
  ('a5000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  ('a5000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002');

-- A placed, paid order at `location` for the customer, made the way checkout
-- and the webhook make one.
create function pg_temp.paid_order(p_key text, p_location uuid)
returns uuid
language plpgsql
as $$
declare
  new_id uuid;
begin
  select order_id into new_id from public.create_checkout_order(
    jsonb_build_object(
      'user_id', 'a5000000-0000-0000-0000-000000000004', 'location_id', p_location,
      'pickup_type', 'asap', 'subtotal_cents', 600, 'discount_cents', 0, 'taxable_base_cents', 600,
      'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', 600,
      'customer_first_name', 'Kai', 'idempotency_key', p_key
    ),
    jsonb_build_array(jsonb_build_object(
      'product_name', 'Status Latte', 'modifiers', '[]'::jsonb,
      'base_price_cents', 600, 'unit_price_cents', 600, 'quantity', 1, 'line_total_cents', 600
    ))
  );
  perform public.mark_order_paid(new_id, 'pi_' || p_key, 'ch_' || p_key, 600, 'usd');
  return new_id;
end;
$$;

create function pg_temp.oid(p_key text)
returns uuid
language sql
as $$ select id from public.orders where idempotency_key = p_key $$;

select pg_temp.paid_order('status-a1', 'a1000000-0000-0000-0000-000000000001');
select pg_temp.paid_order('status-b1', 'a1000000-0000-0000-0000-000000000002');
select pg_temp.paid_order('status-a2', 'a1000000-0000-0000-0000-000000000001');

-- A free order (no payment row), e.g. a whole order paid with a reward.
select public.create_checkout_order(
  jsonb_build_object(
    'user_id', 'a5000000-0000-0000-0000-000000000004', 'location_id', 'a1000000-0000-0000-0000-000000000001',
    'pickup_type', 'asap', 'subtotal_cents', 0, 'discount_cents', 0, 'taxable_base_cents', 0,
    'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', 0, 'idempotency_key', 'status-free'
  ),
  '[]'::jsonb
);
update public.orders set status = 'placed' where idempotency_key = 'status-free';

select is((select status::text from public.orders where id = pg_temp.oid('status-a1')), 'placed', 'fixture: paid order is placed');

-- ---------------------------------------------------------------------------
-- No direct writes for anyone but the service role.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$update public.orders set total_cents = 1 where id = %L$$, pg_temp.oid('status-a1'))),
  '42501', 'staff cannot change an order total at their own location');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$update public.orders set status = 'accepted' where id = %L$$, pg_temp.oid('status-a1'))),
  '42501', 'staff cannot update status directly either');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$update public.order_items set unit_price_cents = 1 where order_id = %L$$, pg_temp.oid('status-a1'))),
  '42501', 'staff cannot change order items');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$delete from public.order_items where order_id = %L$$, pg_temp.oid('status-a1'))),
  '42501', 'staff cannot delete order items');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$insert into public.order_status_history (order_id, to_status) values (%L, 'ready')$$, pg_temp.oid('status-a1'))),
  '42501', 'staff cannot write status history');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000003',
    format($$update public.orders set tip_cents = 0 where id = %L$$, pg_temp.oid('status-a1'))),
  '42501', 'not even an admin edits an order row directly');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000004',
    format($$update public.orders set status = 'cancelled', cancellation_reason = 'x' where id = %L$$, pg_temp.oid('status-a1'))),
  '42501', 'a customer cannot update their own order');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000004',
    format($$update public.payments set refunded_cents = 600 where order_id = %L$$, pg_temp.oid('status-a1'))),
  '42501', 'a customer cannot touch payments');

-- ---------------------------------------------------------------------------
-- advance_order_status: who may call it.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000004',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('status-a1'))),
  '42501', 'a customer cannot change the status of their own order');
select is(
  pg_temp.as_user(null, format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('status-a1'))),
  '42501', 'a guest cannot call advance_order_status');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('status-b1'))),
  '42501', 'staff cannot advance another location''s order');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    $$select public.advance_order_status(gen_random_uuid(), 'accepted')$$),
  '42501', 'an unknown order id looks the same as a forbidden one');
select is((select status::text from public.orders where id = pg_temp.oid('status-b1')), 'placed',
  'the other location''s order is unchanged');

-- ---------------------------------------------------------------------------
-- Transitions.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'picked_up')$$, pg_temp.oid('status-a1'))),
  '23514', 'placed cannot jump straight to picked_up');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'ready')$$, pg_temp.oid('status-a1'))),
  '23514', 'placed cannot skip to ready');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'refunded')$$, pg_temp.oid('status-a1'))),
  '22023', 'refunded is not reachable through the staff function');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'placed')$$, pg_temp.oid('status-a1'))),
  '22023', 'placed is not reachable through the staff function');

select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('status-a1'))),
  'ok', 'rostered staff can accept a placed order');

select ok(
  (select status = 'accepted' and accepted_at is not null and total_cents = 600 and customer_first_name = 'Kai'
     from public.orders where id = pg_temp.oid('status-a1')),
  'accepting sets status and accepted_at and nothing else');

select is(
  (select changed_by from public.order_status_history
    where order_id = pg_temp.oid('status-a1') and to_status = 'accepted'),
  'a5000000-0000-0000-0000-000000000001'::uuid,
  'the history records which staff member accepted it');

select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000003',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('status-b1'))),
  'ok', 'an admin can advance an order at any location');
select is(
  (select changed_by from public.order_status_history
    where order_id = pg_temp.oid('status-b1') and to_status = 'accepted'),
  'a5000000-0000-0000-0000-000000000003'::uuid,
  'the history records the admin');

-- ---------------------------------------------------------------------------
-- Cancelling.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'cancelled')$$, pg_temp.oid('status-free'))),
  '22023', 'cancelling needs a reason');
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'cancelled', 'Out of oat milk')$$, pg_temp.oid('status-a2'))),
  'DC002', 'a paid order cannot be cancelled without a refund');
select is((select status::text from public.orders where id = pg_temp.oid('status-a2')), 'placed',
  'the paid order is still placed');

select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'cancelled', '  Customer asked us to  ')$$, pg_temp.oid('status-free'))),
  'ok', 'an unpaid order can be cancelled with a reason');
select is(
  (select cancellation_reason from public.orders where id = pg_temp.oid('status-free')),
  'Customer asked us to', 'the reason is stored, trimmed');
select ok(
  exists (select 1 from public.order_status_history
           where order_id = pg_temp.oid('status-free') and to_status = 'cancelled'
             and reason = 'Customer asked us to' and changed_by = 'a5000000-0000-0000-0000-000000000001'),
  'the cancellation is in the history with its reason and actor');

-- ---------------------------------------------------------------------------
-- cancel_order_for_refund: the server's cancel-with-refund, step one.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('a5000000-0000-0000-0000-000000000001',
    format($$select public.cancel_order_for_refund(%L, 'reason', 'a5000000-0000-0000-0000-000000000001')$$, pg_temp.oid('status-a2'))),
  '42501', 'staff cannot call cancel_order_for_refund themselves');
select is(
  public.cancel_order_for_refund(pg_temp.oid('status-a2'), 'Sold out of mochi', 'a5000000-0000-0000-0000-000000000002'),
  'forbidden', 'staff from another location are refused');
select is(
  public.cancel_order_for_refund(pg_temp.oid('status-a2'), 'Sold out of mochi', 'a5000000-0000-0000-0000-000000000001'),
  'cancelled', 'rostered staff can cancel a paid order for refund');
select ok(
  exists (select 1 from public.order_status_history
           where order_id = pg_temp.oid('status-a2') and to_status = 'cancelled'
             and reason = 'Sold out of mochi' and changed_by = 'a5000000-0000-0000-0000-000000000001'),
  'the refund cancellation records the staff member, not the service role');

select * from finish();
rollback;

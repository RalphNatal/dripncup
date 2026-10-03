-- ============================================================================
-- Phase 6: the staff dashboard's database rules.
--
--   * staff read and act on their own counters' orders only
--   * repeating a status move is a no-op, not an error
--   * sold out: only through set_sold_out(), only for rostered counters, and
--     every change is logged with who made it
--   * pause with an automatic resume
--   * a roster row stops counting once the person is no longer staff
--   * the catering prep list and a ticket's activity, scoped to the counter
--   * staff settings readable by staff; get_setting() closed to clients
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(50);

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

-- Runs a query returning one value as `uid`, and returns it as text.
create function pg_temp.value_as(uid uuid, sql text)
returns text
language plpgsql
as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid)::text, true);
  execute 'set local role authenticated';
  execute sql into result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--   b6...01 staff at cafe A    b6...02 staff at cafe B    b6...03 admin
--   b6...04 customer           b6...05 ex-staff (now a customer) still rostered at A
--   b1...01 cafe A             b1...02 cafe B
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('b6000000-0000-0000-0000-000000000001', 'p6-staff-a@drincup.test', '{"full_name": "Keala Alpha"}'),
  ('b6000000-0000-0000-0000-000000000002', 'p6-staff-b@drincup.test', '{"full_name": "Noa Bravo"}'),
  ('b6000000-0000-0000-0000-000000000003', 'p6-admin@drincup.test',   '{"full_name": "Ana Admin"}'),
  ('b6000000-0000-0000-0000-000000000004', 'p6-cust@drincup.test',    '{"full_name": "Kai Customer"}'),
  ('b6000000-0000-0000-0000-000000000005', 'p6-former@drincup.test',  '{"full_name": "Former Staff"}');

update public.profiles set role = 'staff' where id in ('b6000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000002');
update public.profiles set role = 'admin' where id = 'b6000000-0000-0000-0000-000000000003';

insert into public.locations (id, type, name, slug, sort_order) values
  ('b1000000-0000-0000-0000-000000000001', 'cafe', 'P6 Cafe A', 'p6-cafe-a', -100),
  ('b1000000-0000-0000-0000-000000000002', 'cafe', 'P6 Cafe B', 'p6-cafe-b', -99);

insert into public.staff_locations (profile_id, location_id) values
  ('b6000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  ('b6000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002'),
  ('b6000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000001');

insert into public.categories (id, name, slug) values ('b2000000-0000-0000-0000-000000000001', 'P6 Drinks', 'p6-drinks');
insert into public.products (id, category_id, name, slug) values
  ('b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'P6 Latte', 'p6-latte');
insert into public.modifier_groups (id, name, slug) values ('b4000000-0000-0000-0000-000000000001', 'P6 Milk', 'p6-milk');
insert into public.modifier_options (id, modifier_group_id, name) values
  ('b5000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', 'P6 Oat milk');

create function pg_temp.paid_order(p_key text, p_location uuid)
returns uuid
language plpgsql
as $$
declare
  new_id uuid;
begin
  select order_id into new_id from public.create_checkout_order(
    jsonb_build_object(
      'user_id', 'b6000000-0000-0000-0000-000000000004', 'location_id', p_location,
      'pickup_type', 'asap', 'subtotal_cents', 600, 'discount_cents', 0, 'taxable_base_cents', 600,
      'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', 600,
      'customer_first_name', 'Kai', 'idempotency_key', p_key
    ),
    jsonb_build_array(jsonb_build_object(
      'product_name', 'P6 Latte', 'modifiers', '[]'::jsonb,
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

select pg_temp.paid_order('p6-a1', 'b1000000-0000-0000-0000-000000000001');
select pg_temp.paid_order('p6-b1', 'b1000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Reading orders.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    format($$select count(*) from public.orders where id = %L$$, pg_temp.oid('p6-a1'))),
  '1', 'staff see their own counter''s order');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    format($$select count(*) from public.orders where id = %L$$, pg_temp.oid('p6-b1'))),
  '0', 'staff do not see another counter''s order');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    format($$select count(*) from public.order_items where order_id = %L$$, pg_temp.oid('p6-b1'))),
  '0', 'nor its items');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000003',
    format($$select count(*) from public.orders where id in (%L, %L)$$, pg_temp.oid('p6-a1'), pg_temp.oid('p6-b1'))),
  '2', 'an admin sees every counter');

-- A roster row left behind after a demotion no longer grants anything.
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000005',
    format($$select count(*) from public.orders where id = %L$$, pg_temp.oid('p6-a1'))),
  '0', 'a former staff member with a leftover roster row cannot read the counter''s orders');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000005',
    $$select public.can_access_location('b1000000-0000-0000-0000-000000000001')::text$$),
  'false', 'can_access_location ignores a roster row for a non-staff profile');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000005',
    $$select public.set_location_accepting_orders('b1000000-0000-0000-0000-000000000001', false)$$),
  '42501', 'and they cannot pause it');

-- ---------------------------------------------------------------------------
-- Acting on orders.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('p6-b1'))),
  '42501', 'staff cannot advance another counter''s order');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    format($$select public.staff_order_activity(%L)$$, pg_temp.oid('p6-b1'))),
  '42501', 'nor read its activity');

select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('p6-a1'))),
  'ok', 'first tap: accepted');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000003',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('p6-a1'))),
  'ok', 'a second device tapping Accept again is not an error');
select is(
  (select count(*)::int from public.order_status_history
    where order_id = pg_temp.oid('p6-a1') and to_status = 'accepted'),
  1, 'the repeat wrote no second history row');
select is(
  (select changed_by from public.order_status_history
    where order_id = pg_temp.oid('p6-a1') and to_status = 'accepted'),
  'b6000000-0000-0000-0000-000000000001'::uuid, 'the history keeps the barista who really accepted it');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000003',
    format($$select (public.advance_order_status(%L, 'accepted')).status::text$$, pg_temp.oid('p6-a1'))),
  'accepted', 'the repeat returns the order as it is');

select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'preparing')$$, pg_temp.oid('p6-a1'))),
  'ok', 'start preparing');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'accepted')$$, pg_temp.oid('p6-a1'))),
  '23514', 'a stale Accept after the order moved on is still refused (no going backwards)');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'ready')$$, pg_temp.oid('p6-a1'))),
  'ok', 'ready');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    format($$select public.advance_order_status(%L, 'ready')$$, pg_temp.oid('p6-a1'))),
  'ok', 'ready again is a no-op');
select is(
  (select count(*)::int from public.order_status_history
    where order_id = pg_temp.oid('p6-a1') and to_status = 'ready'),
  1, 'still one Ready in the history');

-- The activity view names who did what.
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    format($$select string_agg((h ->> 'to_status') || ':' || coalesce(h ->> 'actor_name', 'system'), ',')
               from jsonb_array_elements(public.staff_order_activity(%L) -> 'history') h$$, pg_temp.oid('p6-a1'))),
  'pending_payment:system,placed:system,accepted:Keala,preparing:Keala,ready:Keala',
  'the activity lists each step with the staff member''s first name');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    format($$select public.staff_order_activity(%L) ->> 'refundable_cents'$$, pg_temp.oid('p6-a1'))),
  '600', 'and what a cancel would refund');

-- ---------------------------------------------------------------------------
-- Sold out.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$insert into public.location_availability (location_id, product_id, is_available)
      values ('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', false)$$),
  '42501', 'staff cannot write the sold-out table directly, even for their own counter');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000002', 'b3000000-0000-0000-0000-000000000001')$$),
  '42501', 'staff cannot mark something sold out at another counter');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000004',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001')$$),
  '42501', 'customers cannot mark anything sold out');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000005',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001')$$),
  '42501', 'a former staff member cannot either');
select is(
  pg_temp.as_user(null,
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001')$$),
  '42501', 'nor can a guest');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
        null, true, now() - interval '1 minute')$$),
  '22023', 'a reset time in the past is refused');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
        'b5000000-0000-0000-0000-000000000001')$$),
  '22023', 'exactly one product or option at a time');

select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
        null, true, now() + interval '10 hours')$$),
  'ok', 'staff mark a product sold out until the end of the day');
select ok(
  (select not is_available and available_from = now() + interval '10 hours'
          and updated_by = 'b6000000-0000-0000-0000-000000000001'
     from public.location_availability
    where location_id = 'b1000000-0000-0000-0000-000000000001' and product_id = 'b3000000-0000-0000-0000-000000000001'),
  'the flag carries its reset time and who set it');
select is(
  (select actor from public.location_availability_log
    where location_id = 'b1000000-0000-0000-0000-000000000001'
      and product_id = 'b3000000-0000-0000-0000-000000000001' and action = 'sold_out'),
  'b6000000-0000-0000-0000-000000000001'::uuid, 'the audit log records the actor');

select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
        null, true, null)$$),
  'ok', 'switching it to "until I turn it back on" updates the same flag');
select is(
  (select count(*)::int from public.location_availability
    where location_id = 'b1000000-0000-0000-0000-000000000001' and product_id = 'b3000000-0000-0000-0000-000000000001'
      and available_from is null),
  1, 'one flag, now with no reset time');

select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000003',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001',
        null, false)$$),
  'ok', 'an admin turns it back on');
select is(
  (select count(*)::int from public.location_availability
    where location_id = 'b1000000-0000-0000-0000-000000000001' and product_id = 'b3000000-0000-0000-0000-000000000001'),
  0, 'back on means no flag');
select is(
  (select string_agg(action || ':' || coalesce(actor::text, 'system'), ',' order by created_at, action desc)
     from public.location_availability_log
    where location_id = 'b1000000-0000-0000-0000-000000000001' and product_id = 'b3000000-0000-0000-0000-000000000001'),
  'sold_out:b6000000-0000-0000-0000-000000000001,sold_out:b6000000-0000-0000-0000-000000000001,available:b6000000-0000-0000-0000-000000000003',
  'every change is in the log with its actor');

select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_sold_out('b1000000-0000-0000-0000-000000000001', null, 'b5000000-0000-0000-0000-000000000001')$$),
  'ok', 'options can be marked sold out too');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000002',
    $$select count(*) from public.location_availability_log where location_id = 'b1000000-0000-0000-0000-000000000001'$$),
  '0', 'another counter''s staff cannot read this counter''s log');

-- ---------------------------------------------------------------------------
-- Pause with an automatic resume.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_location_accepting_orders('b1000000-0000-0000-0000-000000000001', false, now() + interval '15 minutes')$$),
  'ok', 'staff pause their counter for 15 minutes');
select ok(
  (select not accepting_orders and paused_until = now() + interval '15 minutes'
          and paused_by = 'b6000000-0000-0000-0000-000000000001' and paused_at is not null
     from public.locations where id = 'b1000000-0000-0000-0000-000000000001'),
  'the pause records when it ends and who paused');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_location_accepting_orders('b1000000-0000-0000-0000-000000000002', false)$$),
  '42501', 'staff cannot pause another counter');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_location_accepting_orders('b1000000-0000-0000-0000-000000000001', false, now() + interval '2 days')$$),
  '22023', 'an automatic resume must be within 12 hours');
select is(
  pg_temp.as_user('b6000000-0000-0000-0000-000000000001',
    $$select public.set_location_accepting_orders('b1000000-0000-0000-0000-000000000001', true)$$),
  'ok', 'resume');
select ok(
  (select accepting_orders and paused_until is null and paused_by is null
     from public.locations where id = 'b1000000-0000-0000-0000-000000000001'),
  'resuming clears the pause details');

-- ---------------------------------------------------------------------------
-- Catering prep list. The lead-time trigger only checks inserts, so the
-- fixture is created next week and moved to today.
-- ---------------------------------------------------------------------------
insert into public.catering_requests (id, user_id, contact_name, contact_email, contact_phone, event_at, headcount, location_id)
values
  ('b7000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000004', 'Kai Customer', 'p6-cust@drincup.test',
   '+18085550101', now() + interval '5 days', 20, 'b1000000-0000-0000-0000-000000000001'),
  ('b7000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000004', 'Kai Customer', 'p6-cust@drincup.test',
   null, now() + interval '5 days', 40, 'b1000000-0000-0000-0000-000000000002'),
  ('b7000000-0000-0000-0000-000000000003', 'b6000000-0000-0000-0000-000000000004', 'Kai Customer', 'p6-cust@drincup.test',
   null, now() + interval '5 days', 10, 'b1000000-0000-0000-0000-000000000001');
insert into public.catering_request_items (catering_request_id, product_name, quantity)
values ('b7000000-0000-0000-0000-000000000001', 'Cold Brew', 20);
update public.catering_requests set event_at = (public.cafe_today() + time '12:00') at time zone 'Pacific/Honolulu'
 where id::text like 'b7000000%';
update public.catering_requests set status = 'quoted', quote_amount_cents = 30000
 where id in ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');
update public.catering_requests set status = 'confirmed'
 where id in ('b7000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000002');

select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    $$select string_agg(headcount::text || '/' || (items -> 0 ->> 'name'), ',')
        from public.staff_catering_prep('b1000000-0000-0000-0000-000000000001')$$),
  '20/Cold Brew', 'the prep list shows today''s confirmed request at this counter, not the unconfirmed one');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    $$select count(*) from public.staff_catering_prep('b1000000-0000-0000-0000-000000000002')$$),
  '0', 'another counter''s catering is not listed');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    $$select count(*) from public.catering_requests$$),
  '0', 'staff still cannot read catering requests (or their quotes) directly');

-- ---------------------------------------------------------------------------
-- Settings.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000001',
    $$select string_agg(key, ',' order by key) from public.settings
       where key in ('staff.ticket_late_minutes', 'orders.pending_expiry_minutes')$$),
  'staff.ticket_late_minutes', 'staff read the staff settings, not other private ones');
select is(
  pg_temp.value_as('b6000000-0000-0000-0000-000000000004',
    $$select count(*) from public.settings where key like 'staff.%'$$),
  '0', 'customers cannot read staff settings');
select is(
  pg_temp.as_user(null, $$select public.get_setting('orders.pending_expiry_minutes')$$),
  '42501', 'get_setting is no longer callable from the API');

select * from finish();
rollback;

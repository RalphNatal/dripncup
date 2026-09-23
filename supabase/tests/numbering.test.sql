-- ============================================================================
-- Order and catering numbering: the Honolulu date rollover and access rules.
--
-- Run with `npm run test:db`. Everything happens inside one transaction that
-- is rolled back, so the fixed 2030 instants never leave counter rows behind.
--
-- HST is UTC-10 with no daylight saving:
--   2030-03-14 23:30 HST = 2030-03-15 09:30 UTC
--   2030-03-15 00:30 HST = 2030-03-15 10:30 UTC
-- A UTC-based implementation would put both on the 15th.
-- ============================================================================
begin;

select plan(19);

-- Runs `sql` as `role_name` and reports 'ok' or the SQLSTATE it failed with.
-- The exception block rolls back its subtransaction, which also undoes the
-- SET LOCAL ROLE, so pgTAP always carries on as the test owner.
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

-- ---------------------------------------------------------------------------
-- The date helper
-- ---------------------------------------------------------------------------
select is(
  public.cafe_date('2030-03-15 09:30:00+00'),
  '2030-03-14'::date,
  '11:30 PM HST is still the same Honolulu day, although it is tomorrow in UTC'
);

select is(
  public.cafe_date('2030-03-15 10:30:00+00'),
  '2030-03-15'::date,
  '12:30 AM HST is the next Honolulu day'
);

-- ---------------------------------------------------------------------------
-- Order numbers
-- ---------------------------------------------------------------------------
select is(
  public.next_order_number('2030-03-15 09:30:00+00'),
  'DC-300314-0001',
  '11:30 PM HST produces that day''s date'
);

select is(
  public.next_order_number('2030-03-15 09:59:59+00'),
  'DC-300314-0002',
  'a second order before midnight HST continues that day''s counter'
);

select is(
  public.next_order_number('2030-03-15 10:30:00+00'),
  'DC-300315-0001',
  '12:30 AM HST the next day produces the next date and restarts the counter'
);

select is(
  public.next_order_number('2030-03-15 10:45:00+00'),
  'DC-300315-0002',
  'the new day then counts up from 1'
);

select matches(
  public.next_order_number(),
  '^DC-' || to_char(public.cafe_today(), 'YYMMDD') || '-\d{4}$',
  'without a timestamp, the order number uses today''s Honolulu date'
);

-- ---------------------------------------------------------------------------
-- Catering numbers share the table but keep their own sequence
-- ---------------------------------------------------------------------------
select is(
  public.next_catering_number('2030-03-15 09:30:00+00'),
  'CAT-300314-001',
  'catering: 11:30 PM HST produces that day''s date'
);

select is(
  public.next_catering_number('2030-03-15 10:30:00+00'),
  'CAT-300315-001',
  'catering: 12:30 AM HST the next day produces the next date and restarts the counter'
);

select is(
  public.next_order_number('2030-03-15 11:00:00+00'),
  'DC-300315-0003',
  'catering numbers do not consume order numbers'
);

-- ---------------------------------------------------------------------------
-- The column defaults still work with no argument
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.daily_counters where counter_day = '2030-03-14'),
  2,
  'the 14th has one counter row per scope'
);

-- ---------------------------------------------------------------------------
-- Access rules are unchanged by the new parameter
-- ---------------------------------------------------------------------------
select is(
  pg_temp.try_as('anon', 'select public.next_order_number()'),
  '42501',
  'anon cannot take an order number'
);

select is(
  pg_temp.try_as('anon', 'select public.next_catering_number()'),
  '42501',
  'anon cannot take a catering number'
);

select is(
  pg_temp.try_as('anon', 'select public.next_daily_number(''order'')'),
  '42501',
  'anon cannot bump a counter directly'
);

set local request.jwt.claims to '{"role": "authenticated", "sub": "00000000-0000-0000-0000-00000000c0de"}';

select is(
  pg_temp.try_as('authenticated', 'select public.next_order_number()'),
  '42501',
  'a signed-in customer cannot take an order number (orders are created server-side)'
);

select is(
  pg_temp.try_as('authenticated', 'select public.next_daily_number(''order'')'),
  '42501',
  'a signed-in customer cannot bump a counter directly'
);

select is(
  pg_temp.try_as('authenticated', 'select public.next_catering_number()'),
  'ok',
  'a signed-in customer can take today''s catering number (the column default needs it)'
);

select is(
  pg_temp.try_as('authenticated', 'select public.next_catering_number(''2030-03-15 09:30:00+00'')'),
  '42501',
  'a signed-in customer cannot number a catering request for another date'
);

set local request.jwt.claims to '{"role": "service_role"}';

select is(
  pg_temp.try_as('service_role', 'select public.next_order_number(''2030-03-15 11:15:00+00'')'),
  'ok',
  'the service role can number orders, including at a fixed instant'
);

select * from finish();
rollback;

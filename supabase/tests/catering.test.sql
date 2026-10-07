-- ============================================================================
-- Phase 8: the catering workflow's database rules.
--
--   * nobody writes catering tables through the API; requests are created by
--     the server, status changes go through definer functions
--   * transitions and their history, with the actor
--   * quote versions: issued only by the server for an admin, immutable,
--     one active at a time, every version kept
--   * who reads what: the owner, not another customer, not staff (the prep
--     list function only), not guests; admins everything
--   * paying: only the owner, only the current quote, not expired, not past
--     the deadline; the payment function confirms only the current quote at
--     its exact amount, once
--   * emails owed by each change land in the outbox
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(69);

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
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return sqlstate;
end;
$$;

-- Runs a query returning one value as `uid` (null = anon), and returns it as text.
create function pg_temp.value_as(uid uuid, sql text)
returns text
language plpgsql
as $$
declare
  result text;
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', uid)::text, true);
    execute 'set local role authenticated';
  end if;
  execute sql into result;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return result;
end;
$$;

-- A quote the way issueQuoteAction sends it: one menu line, totals that add up.
create function pg_temp.quote_json(total integer, expires timestamptz)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'items_subtotal_cents', total, 'discount_cents', 0, 'delivery_fee_cents', 0, 'delivery_fee_taxable', true,
    'taxable_cents', total, 'tax_rate', 0, 'tax_cents', 0, 'gratuity_cents', 0, 'total_cents', total,
    'expires_at', expires, 'note_to_customer', 'Mahalo for thinking of us!'
  );
$$;

create function pg_temp.quote_lines(total integer)
returns jsonb
language sql
as $$
  select jsonb_build_array(jsonb_build_object(
    'kind', 'product', 'product_id', 'c8300000-0000-0000-0000-000000000001', 'product_size_id', null,
    'description', 'P8 Latte', 'size_name', null, 'quantity', 1, 'unit_price_cents', total, 'line_total_cents', total
  ));
$$;

-- ---------------------------------------------------------------------------
-- Fixtures.
--   c8...01 customer A   c8...02 customer B   c8...03 staff at counter X
--   c8...04 staff at counter Y   c8...05 admin
--   c81..01 counter X    c81..02 counter Y
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c8000000-0000-0000-0000-000000000001', 'p8-a@drincup.test',     '{"full_name": "Ana Alpha"}'),
  ('c8000000-0000-0000-0000-000000000002', 'p8-b@drincup.test',     '{"full_name": "Ben Bravo"}'),
  ('c8000000-0000-0000-0000-000000000003', 'p8-staff-x@drincup.test', '{"full_name": "Sam Staff"}'),
  ('c8000000-0000-0000-0000-000000000004', 'p8-staff-y@drincup.test', '{"full_name": "Yuki Staff"}'),
  ('c8000000-0000-0000-0000-000000000005', 'p8-admin@drincup.test', '{"full_name": "Ada Admin"}');
update public.profiles set role = 'staff' where id in ('c8000000-0000-0000-0000-000000000003', 'c8000000-0000-0000-0000-000000000004');
update public.profiles set role = 'admin' where id = 'c8000000-0000-0000-0000-000000000005';

insert into public.locations (id, type, name, slug, sort_order) values
  ('c8100000-0000-0000-0000-000000000001', 'cafe', 'P8 Counter X', 'p8-counter-x', -200),
  ('c8100000-0000-0000-0000-000000000002', 'cafe', 'P8 Counter Y', 'p8-counter-y', -199);
insert into public.staff_locations (profile_id, location_id) values
  ('c8000000-0000-0000-0000-000000000003', 'c8100000-0000-0000-0000-000000000001'),
  ('c8000000-0000-0000-0000-000000000004', 'c8100000-0000-0000-0000-000000000002');
insert into public.products (id, name, slug, is_catering_eligible) values
  ('c8300000-0000-0000-0000-000000000001', 'P8 Latte', 'p8-latte', true);

-- ---------------------------------------------------------------------------
-- Creating requests.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$
    insert into public.catering_requests (user_id, contact_name, contact_email, event_at, headcount)
    values ('c8000000-0000-0000-0000-000000000001', 'Ana', 'p8-a@drincup.test', now() + interval '10 days', 10)$$),
  '42501', 'a customer cannot insert a catering request directly (the server validates and rate-limits)');

select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$
    select public.create_catering_request('c8000000-0000-0000-0000-000000000001', '{}'::jsonb, '[]'::jsonb)$$),
  '42501', 'create_catering_request is not callable from the API');

select throws_ok(
  $$select public.create_catering_request('c8000000-0000-0000-0000-000000000001',
      jsonb_build_object('location_id', 'c8100000-0000-0000-0000-000000000001', 'contact_name', 'Ana Alpha',
        'contact_email', 'p8-a@drincup.test', 'event_at', now() + interval '24 hours', 'headcount', 10, 'fulfillment', 'pickup'),
      '[]'::jsonb)$$,
  '23514', null, 'a request inside the 72-hour lead time is refused by the database');

-- R1: A's request, ten days out, at counter X.
create temp table r1 as
select request_id as id, request_number from public.create_catering_request('c8000000-0000-0000-0000-000000000001',
  jsonb_build_object('location_id', 'c8100000-0000-0000-0000-000000000001', 'contact_name', 'Ana Alpha',
    'contact_email', 'p8-a@drincup.test', 'contact_phone', '(808) 555-0101', 'event_at', now() + interval '10 days',
    'headcount', 30, 'fulfillment', 'pickup', 'notes', 'Office party'),
  jsonb_build_array(jsonb_build_object('product_id', 'c8300000-0000-0000-0000-000000000001', 'product_size_id', null,
    'product_name', 'P8 Latte', 'size_name', null, 'quantity', 30)));
grant select on r1 to authenticated, anon;

select matches((select request_number from r1), '^CAT-\d{6}-\d{3}$', 'requests get a CAT-YYMMDD-### number');
select is(
  (select to_status::text || '/' || (changed_by = 'c8000000-0000-0000-0000-000000000001')::text
     from public.catering_status_history where catering_request_id = (select id from r1)),
  'submitted/true', 'creation is recorded in the history with the customer as the actor');
select is(
  (select string_agg(kind, ',' order by kind) from public.email_outbox where catering_request_id = (select id from r1)),
  'catering_admin_new,catering_received', 'the customer and the admin are emailed about a new request');
select is(
  (select location_id from public.catering_requests where id = (select id from r1)),
  'c8100000-0000-0000-0000-000000000001'::uuid, 'the request keeps the counter it was created for');

-- ---------------------------------------------------------------------------
-- Who can read and write it.
-- ---------------------------------------------------------------------------
select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000001', $$select count(*) from public.catering_requests where id = (select id from r1)$$),
  '1', 'the owner reads their request');
select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000002', $$select count(*) from public.catering_requests where id = (select id from r1)$$),
  '0', 'another customer cannot read it');
select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000003', $$select count(*) from public.catering_requests$$),
  '0', 'staff cannot read catering requests directly, even at their own counter');
select is(pg_temp.value_as(null, $$select count(*) from public.catering_requests$$), '0', 'guests read nothing');
select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000005', $$select count(*) from public.catering_requests where id = (select id from r1)$$),
  '1', 'admins read every request');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$update public.catering_requests set status = 'confirmed' where id = (select id from r1)$$),
  '42501', 'the owner cannot change the status directly');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000005', $$update public.catering_requests set headcount = 5 where id = (select id from r1)$$),
  '42501', 'admins have no direct write either: only the definer functions');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$insert into public.catering_messages (catering_request_id, author_role, kind, body) values ((select id from r1), 'admin', 'note', 'hi')$$),
  '42501', 'nobody inserts messages directly (a customer cannot pose as the cafe)');

-- ---------------------------------------------------------------------------
-- Quoting.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000005', $$
    select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', (select id from r1),
      pg_temp.quote_json(15000, now() + interval '5 days'), pg_temp.quote_lines(15000))$$),
  '42501', 'an admin cannot issue a quote through the API: totals are computed on the server');
select throws_ok(
  $$select public.catering_issue_quote('c8000000-0000-0000-0000-000000000003', (select id from r1),
      pg_temp.quote_json(15000, now() + interval '5 days'), pg_temp.quote_lines(15000))$$,
  '42501', null, 'the server cannot quote in a non-admin''s name');
select throws_ok(
  $$select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', (select id from r1),
      pg_temp.quote_json(15000, now() + interval '9 days'), pg_temp.quote_lines(15000))$$,
  '22023', null, 'a quote cannot expire after the payment deadline (48 hours before the event)');
select throws_ok(
  $$select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', (select id from r1),
      pg_temp.quote_json(15000, now() + interval '5 days') || '{"total_cents": 99}', pg_temp.quote_lines(15000))$$,
  '23514', null, 'a quote whose totals do not add up cannot be stored');
select throws_ok(
  $$select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', (select id from r1),
      pg_temp.quote_json(15000, now() + interval '5 days'), pg_temp.quote_lines(14000))$$,
  '23514', null, 'quote lines must add up to the quote''s items');

create temp table q1 as
select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', (select id from r1),
  pg_temp.quote_json(15000, now() + interval '5 days'), pg_temp.quote_lines(15000)) as id;
grant select on q1 to authenticated, anon;

select is(
  (select status::text || '/' || (current_quote_id = (select id from q1))::text from public.catering_requests where id = (select id from r1)),
  'quoted/true', 'issuing a quote moves the request to quoted and points at the quote');
select is(
  (select (changed_by = 'c8000000-0000-0000-0000-000000000005')::text || '/' || reason from public.catering_status_history
    where catering_request_id = (select id from r1) and to_status = 'quoted'),
  'true/Quote sent (version 1)', 'the history names the admin who quoted');
select is(
  (select count(*)::int from public.email_outbox where kind = 'catering_quote_ready' and catering_quote_id = (select id from q1)),
  1, 'the customer is emailed that the quote is ready');
select is(
  (select payment_deadline_at = c.event_at - interval '48 hours' from public.catering_quotes q join public.catering_requests c on c.id = q.catering_request_id where q.id = (select id from q1)),
  true, 'the quote carries the payment deadline: 48 hours before the event');
select throws_ok(
  $$update public.catering_quotes set total_cents = 1 where id = (select id from q1)$$,
  '23514', null, 'an issued quote cannot be changed (not even by the database owner)');
select throws_ok(
  $$update public.catering_quote_lines set unit_price_cents = 1, line_total_cents = 1 where quote_id = (select id from q1)$$,
  '23514', null, 'an issued quote''s lines cannot be changed');

select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000001', $$select count(*) from public.catering_quote_lines where quote_id = (select id from q1)$$),
  '1', 'the owner reads their quote''s lines');
select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000002', $$select count(*) from public.catering_quotes where id = (select id from q1)$$),
  '0', 'another customer cannot read the quote');
select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000002', $$select count(*) from public.catering_quote_lines where quote_id = (select id from q1)$$),
  '0', '... or its lines');
select is(pg_temp.value_as('c8000000-0000-0000-0000-000000000003', $$select count(*) from public.catering_quotes$$),
  '0', 'staff cannot read quotes (no prices on the counter)');

-- ---------------------------------------------------------------------------
-- Changes: the quote goes back, every version is kept.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000002', $$select public.catering_request_changes((select id from r1), 'Cheaper please')$$),
  '42501', 'another customer cannot ask for changes');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$select public.catering_request_changes((select id from r1), 'Half oat milk, please')$$),
  'ok', 'the owner asks for changes');
select is(
  (select status::text || '/' || coalesce(current_quote_id::text, 'none') from public.catering_requests where id = (select id from r1)),
  'submitted/none', 'the request goes back to submitted with no payable quote');
select is((select status from public.catering_quotes where id = (select id from q1)), 'superseded', 'the old quote is kept, superseded');
select is(
  (select (changed_by = 'c8000000-0000-0000-0000-000000000001')::text || '/' || reason from public.catering_status_history
    where catering_request_id = (select id from r1) and from_status = 'quoted' and to_status = 'submitted'),
  'true/Customer asked for changes', 'the history records the customer asking for changes');
select is(
  (select count(*)::int from public.email_outbox where kind = 'catering_admin_change_request' and catering_request_id = (select id from r1)),
  1, 'the admin is emailed about the change request');

create temp table q2 as
select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', (select id from r1),
  pg_temp.quote_json(14500, now() + interval '5 days'), pg_temp.quote_lines(14500)) as id;
create temp table q3 as
select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', (select id from r1),
  pg_temp.quote_json(14000, now() + interval '5 days'), pg_temp.quote_lines(14000)) as id;
grant select on q2, q3 to authenticated, anon;

select is(
  (select string_agg(version || ':' || status, ',' order by version) from public.catering_quotes where catering_request_id = (select id from r1)),
  '1:superseded,2:superseded,3:active', 'every version is kept; only the latest is active');
select is(
  (select reason from public.catering_status_history where catering_request_id = (select id from r1) and from_status = 'quoted' and to_status = 'quoted'),
  'Quote revised (version 3)', 'reissuing a quote is recorded even though the status stays quoted');

-- ---------------------------------------------------------------------------
-- Paying: whose, which quote, when.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000002', $$select public.catering_payable_quote((select id from r1), (select id from q3))$$),
  '42501', 'another customer cannot pay the quote');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$select public.catering_payable_quote((select id from r1), (select id from q2))$$),
  'DC011', 'the owner cannot pay a quote that is no longer current');
select is(
  pg_temp.value_as('c8000000-0000-0000-0000-000000000001', $$select (public.catering_payable_quote((select id from r1), (select id from q3)) ->> 'total_cents')$$),
  '14000', 'the owner can pay the current quote, at its stored total');
select is(
  pg_temp.as_user(null, $$select public.catering_payable_quote((select id from r1), (select id from q3))$$),
  '42501', 'guests cannot pay anything');

-- R2 and R3: quotes past their expiry, and past the payment deadline (written
-- directly; the issuing function would refuse both).
insert into public.catering_requests (id, user_id, contact_name, contact_email, event_at, headcount, location_id)
values ('c8200000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000001', 'Ana', 'p8-a@drincup.test', now() + interval '10 days', 5, 'c8100000-0000-0000-0000-000000000001'),
       ('c8200000-0000-0000-0000-000000000003', 'c8000000-0000-0000-0000-000000000001', 'Ana', 'p8-a@drincup.test', now() + interval '4 days', 5, 'c8100000-0000-0000-0000-000000000001');
update public.catering_requests set event_at = now() + interval '1 day' where id = 'c8200000-0000-0000-0000-000000000003';
insert into public.catering_quotes (id, catering_request_id, version, items_subtotal_cents, taxable_cents, tax_rate, tax_cents, total_cents, expires_at, payment_deadline_at)
values ('c8400000-0000-0000-0000-000000000002', 'c8200000-0000-0000-0000-000000000002', 1, 500, 500, 0, 0, 500, now() - interval '1 hour', now() + interval '8 days'),
       ('c8400000-0000-0000-0000-000000000003', 'c8200000-0000-0000-0000-000000000003', 1, 500, 500, 0, 0, 500, now() - interval '1 day', now() - interval '1 day');
update public.catering_requests set status = 'quoted', current_quote_id = 'c8400000-0000-0000-0000-000000000002' where id = 'c8200000-0000-0000-0000-000000000002';
update public.catering_requests set status = 'quoted', current_quote_id = 'c8400000-0000-0000-0000-000000000003' where id = 'c8200000-0000-0000-0000-000000000003';

select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$select public.catering_payable_quote('c8200000-0000-0000-0000-000000000002', 'c8400000-0000-0000-0000-000000000002')$$),
  'DC012', 'an expired quote cannot be paid');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$select public.catering_payable_quote('c8200000-0000-0000-0000-000000000003', 'c8400000-0000-0000-0000-000000000003')$$),
  'DC013', 'a quote past the payment deadline cannot be paid');
select throws_ok(
  $$select public.catering_issue_quote('c8000000-0000-0000-0000-000000000005', 'c8200000-0000-0000-0000-000000000003',
      pg_temp.quote_json(500, now() + interval '1 hour'), pg_temp.quote_lines(500))$$,
  'DC013', null, 'no new quote can be issued once the payment deadline has passed');

-- The payment function (webhook / reconcile).
select is(
  public.mark_catering_paid((select id from r1), (select id from q2), 'pi_p8_stale', 'ch_p8_stale', 14500, 'usd'),
  'not_payable', 'a payment for a replaced quote does not confirm the request (the caller refunds it)');
select is(
  (select status::text from public.payments where provider_payment_intent_id = 'pi_p8_stale'), 'succeeded',
  'the money is recorded even so');
select is(
  public.mark_catering_paid((select id from r1), (select id from q3), 'pi_p8_short', 'ch_p8_short', 100, 'usd'),
  'amount_mismatch', 'a payment that does not match the quote is not confirmed');
select ok(
  (select flagged_for_review_at is not null and status = 'quoted' from public.catering_requests where id = (select id from r1)),
  '... it is flagged for an admin and the request stays quoted');
select is(
  public.mark_catering_paid((select id from r1), (select id from q3), 'pi_p8_good', 'ch_p8_good', 14000, 'usd'),
  'confirmed', 'the current quote paid in full confirms the request');
select is(
  (select r.status::text || '/' || q.status from public.catering_requests r join public.catering_quotes q on q.id = r.current_quote_id where r.id = (select id from r1)),
  'confirmed/paid', 'request confirmed, quote paid');
select is(
  public.mark_catering_paid((select id from r1), (select id from q3), 'pi_p8_good', 'ch_p8_good', 14000, 'usd'),
  'already_confirmed', 'a replayed payment changes nothing');
select is(
  (select string_agg(kind || ':' || n, ',' order by kind) from (
     select kind, count(*) n from public.email_outbox where catering_request_id = (select id from r1) and kind in ('catering_confirmed', 'catering_admin_paid') group by kind) x),
  'catering_admin_paid:1,catering_confirmed:1', 'the receipt and the admin notice are owed once, replay or not');
select is(
  (select changed_by is null from public.catering_status_history where catering_request_id = (select id from r1) and to_status = 'confirmed'),
  true, 'confirmation is recorded as the system''s doing');

-- A full refund of the stray payment does not touch the confirmed request.
select is(public.apply_refund_state('pi_p8_stale', 14500, 'Quote changed'), 'confirmed',
  'refunding a stray payment leaves the request as it is');

-- ---------------------------------------------------------------------------
-- After payment: customers ask, admins cancel with a refund.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$select public.catering_cancel((select id from r1), 'Changed plans')$$),
  'DC015', 'a paid request cannot be cancelled by the customer');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$select public.catering_request_cancellation((select id from r1), 'Our event moved')$$),
  'ok', 'the customer can ask for a cancellation');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000001', $$select public.catering_request_cancellation((select id from r1), 'Again')$$),
  'DC014', '... once');
select is(
  (select count(*)::int from public.email_outbox where kind = 'catering_admin_cancellation_request' and catering_request_id = (select id from r1)),
  1, 'the admin is emailed about the cancellation request');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000005', $$select public.admin_catering_cancel((select id from r1), 'Customer asked')$$),
  'DC015', 'an admin cannot cancel a paid request without the refund path');
select is(
  public.catering_cancel_for_refund('c8000000-0000-0000-0000-000000000003', (select id from r1), 'Customer asked'),
  'forbidden', 'staff cannot cancel a paid request');

-- ---------------------------------------------------------------------------
-- The prep list and fulfilment (before the cancellation below).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.value_as('c8000000-0000-0000-0000-000000000003',
    $$select string_agg(request_number || ' ' || (items -> 0 ->> 'name') || ' x' || (items -> 0 ->> 'quantity'), ',')
        from public.staff_catering_prep('c8100000-0000-0000-0000-000000000001', public.cafe_date(now() + interval '10 days'))$$),
  (select request_number from r1) || ' P8 Latte x1', 'staff at the counter see the confirmed request on its day, with the quoted lines');
select is(
  pg_temp.value_as('c8000000-0000-0000-0000-000000000004',
    $$select count(*) from public.staff_catering_prep('c8100000-0000-0000-0000-000000000001', public.cafe_date(now() + interval '10 days'))$$),
  '0', 'staff at another counter do not');
select is(
  pg_temp.value_as('c8000000-0000-0000-0000-000000000002',
    $$select count(*) from public.staff_catering_prep('c8100000-0000-0000-0000-000000000001', public.cafe_date(now() + interval '10 days'))$$),
  '0', 'customers get nothing from the prep list');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000003', $$select public.catering_mark_fulfilled((select id from r1))$$),
  'DC016', 'it cannot be fulfilled before its day');
select is(
  pg_temp.as_user('c8000000-0000-0000-0000-000000000004', $$select public.catering_mark_fulfilled((select id from r1))$$),
  '42501', 'staff at another counter cannot fulfil it');

select is(
  public.catering_cancel_for_refund('c8000000-0000-0000-0000-000000000005', (select id from r1), 'Customer asked'),
  'cancelled', 'the admin cancels it (the server refunds next)');
select is(
  (select (changed_by = 'c8000000-0000-0000-0000-000000000005')::text from public.catering_status_history
    where catering_request_id = (select id from r1) and to_status = 'cancelled'),
  'true', 'the history names the admin who cancelled');
select throws_ok(
  $$update public.catering_requests set status = 'confirmed' where id = (select id from r1)$$,
  '23514', null, 'a cancelled request cannot come back');

select * from finish();
rollback;

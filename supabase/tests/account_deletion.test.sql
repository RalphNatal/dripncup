-- ============================================================================
-- delete_account_data(): what is cancelled, what is kept, what is scrubbed,
-- and the last-admin guard. The UI flow (password re-entry, sign-out, cannot
-- sign in again) is covered end to end in e2e/account-deletion.spec.ts.
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(31);

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

-- Same idea as the owner, for statements that should fail outright.
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
-- Fixtures. Fixed UUIDs keep the assertions readable.
--   c0...01  the customer who deletes their account
--   c0...02  a second customer, used for the direct-delete guard
--   a0...01  an admin
--   a0...02  a second admin, added part-way through
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-000000000001', 'leaving@drincup.test', '{"full_name": "Kai Leaving"}'),
  ('c0000000-0000-0000-0000-000000000002', 'staying@drincup.test', '{"full_name": "Noe Staying"}'),
  ('a0000000-0000-0000-0000-000000000001', 'boss@drincup.test',    '{"full_name": "Pua Boss"}');

update public.profiles set phone = '+18085550199', first_name = 'Kai'
 where id = 'c0000000-0000-0000-0000-000000000001';

-- Leave exactly one admin: this transaction's. Rolled back afterwards.
update public.profiles set role = 'customer' where role = 'admin';
update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-000000000001';

insert into public.locations (id, type, name, slug)
values ('10000000-0000-0000-0000-000000000001', 'cafe', 'Test Cafe', 'test-cafe-deletion');

insert into public.products (id, name, slug, base_price_cents)
values ('20000000-0000-0000-0000-000000000001', 'Test Latte', 'test-latte-deletion', 500);

-- A finished order, and one still in the queue.
insert into public.orders (
  id, user_id, location_id, status, idempotency_key,
  customer_first_name, customer_phone, customer_email, notes,
  subtotal_cents, taxable_base_cents, tax_cents, total_cents
) values
  ('30000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'picked_up', 'del-test-1',
   'Kai', '+18085550199', 'leaving@drincup.test', 'Leave by the door', 500, 500, 24, 524),
  ('30000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'placed', 'del-test-2',
   'Kai', '+18085550199', 'leaving@drincup.test', null, 500, 500, 24, 524);

insert into public.order_items (order_id, product_id, product_name, base_price_cents, unit_price_cents, line_total_cents)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Test Latte', 500, 500, 500);

insert into public.payments (order_id, provider_payment_intent_id, provider_customer_id, status, amount_cents, raw)
values ('30000000-0000-0000-0000-000000000001', 'pi_del_test', 'cus_del_test', 'succeeded', 524,
        '{"receipt_email": "leaving@drincup.test", "billing_details": {"name": "Kai Leaving"}}');

-- A catering enquiry still open, and one already fulfilled.
insert into public.catering_requests (
  id, user_id, contact_name, contact_email, contact_phone, event_at, headcount,
  fulfillment, delivery_address, notes, status
) values
  ('40000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'Kai Leaving', 'leaving@drincup.test', '+18085550199', now() + interval '10 days', 20,
   'delivery', '1 Private Lane, Honolulu', 'Birthday for my partner', 'submitted'),
  ('40000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   'Kai Leaving', 'leaving@drincup.test', null, now() + interval '20 days', 40,
   'pickup', null, null, 'submitted');

-- Walk the second one to fulfilled through the real transitions.
insert into public.catering_quotes (id, catering_request_id, version, items_subtotal_cents, taxable_cents, tax_rate,
                                    tax_cents, total_cents, expires_at, payment_deadline_at)
values ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 1, 40000, 40000, 0,
        0, 40000, now() + interval '5 days', now() + interval '5 days');
update public.catering_requests set status = 'quoted', current_quote_id = '41000000-0000-0000-0000-000000000002'
 where id = '40000000-0000-0000-0000-000000000002';
update public.catering_requests set status = 'confirmed'
 where id = '40000000-0000-0000-0000-000000000002';
update public.catering_requests set status = 'fulfilled'
 where id = '40000000-0000-0000-0000-000000000002';

insert into public.favorites (user_id, name, product_id)
values ('c0000000-0000-0000-0000-000000000001', 'My usual', '20000000-0000-0000-0000-000000000001');

insert into public.loyalty_transactions (user_id, order_id, type, points, description)
values ('c0000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'earn', 10, 'Test earn');

insert into public.promos (id, code, type, percent)
values ('50000000-0000-0000-0000-000000000001', 'DELTEST', 'percent', 10);
insert into public.promo_redemptions (promo_id, user_id, order_id, amount_cents)
values ('50000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001', 50);

-- ---------------------------------------------------------------------------
-- Only the server may call it
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"role": "authenticated", "sub": "c0000000-0000-0000-0000-000000000001"}';

select is(
  pg_temp.try_as('authenticated', $$select public.delete_account_data('c0000000-0000-0000-0000-000000000001')$$),
  '42501',
  'a signed-in user cannot call delete_account_data directly (the password check lives on the server)'
);

select is(
  pg_temp.try_as('anon', $$select public.delete_account_data('c0000000-0000-0000-0000-000000000001')$$),
  '42501',
  'anon cannot call delete_account_data'
);

reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Delete the customer
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.delete_account_data('c0000000-0000-0000-0000-000000000001')$$,
  'deleting the customer succeeds'
);

-- Orders: kept, detached, scrubbed
select is(
  (select count(*)::int from public.orders where id in (
    '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002')),
  2,
  'both orders still exist for sales and tax reports'
);

select is(
  (select count(*)::int from public.orders where user_id = 'c0000000-0000-0000-0000-000000000001'),
  0,
  'no order is linked to the deleted user any more'
);

select is(
  (select count(*)::int from public.orders
    where id in ('30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002')
      and customer_first_name is null and customer_phone is null
      and customer_email is null and notes is null and anonymized_at is not null),
  2,
  'the cup name, phone, email and notes are cleared, and the orders are marked anonymised'
);

select is(
  (select total_cents from public.orders where id = '30000000-0000-0000-0000-000000000001'),
  524,
  'the money columns are untouched'
);

select is(
  (select status::text from public.orders where id = '30000000-0000-0000-0000-000000000001'),
  'picked_up',
  'a finished order stays finished'
);

select is(
  (select status::text from public.orders where id = '30000000-0000-0000-0000-000000000002'),
  'cancelled',
  'an order still in the queue is cancelled'
);

select ok(
  (select cancellation_reason is not null and cancelled_at is not null
     from public.orders where id = '30000000-0000-0000-0000-000000000002'),
  'the cancellation carries a reason and a timestamp'
);

select is(
  (select count(*)::int from public.order_status_history
    where order_id = '30000000-0000-0000-0000-000000000002' and to_status = 'cancelled'),
  1,
  'the cancellation is in the audit trail'
);

select is(
  (select count(*)::int from public.order_items where order_id = '30000000-0000-0000-0000-000000000001'),
  1,
  'the immutable order-item snapshot is kept'
);

select ok(
  (select raw is null and provider_customer_id is null and amount_cents = 524
     from public.payments where order_id = '30000000-0000-0000-0000-000000000001'),
  'the stored Stripe payload and customer id are cleared; the amount is kept'
);

-- Catering: kept, detached, scrubbed
select is(
  (select status::text from public.catering_requests where id = '40000000-0000-0000-0000-000000000001'),
  'cancelled',
  'an open catering request is cancelled'
);

select is(
  (select status::text from public.catering_requests where id = '40000000-0000-0000-0000-000000000002'),
  'fulfilled',
  'a fulfilled catering request stays fulfilled'
);

select is(
  (select count(*)::int from public.catering_requests
    where id in ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002')
      and user_id is null and contact_name is null and contact_email is null
      and contact_phone is null and delivery_address is null and notes is null
      and anonymized_at is not null),
  2,
  'catering records are kept without contact details or the delivery address'
);

select is(
  (select q.total_cents from public.catering_quotes q
     join public.catering_requests c on c.current_quote_id = q.id
    where c.id = '40000000-0000-0000-0000-000000000002'),
  40000,
  'catering revenue (the quote) is kept'
);

-- Everything else
select is(
  (select count(*)::int from public.favorites where user_id = 'c0000000-0000-0000-0000-000000000001'),
  0,
  'favourites are deleted'
);

select is(
  (select count(*)::int from public.loyalty_transactions where user_id = 'c0000000-0000-0000-0000-000000000001'),
  0,
  'the loyalty ledger rows are deleted'
);

select ok(
  (select user_id is null from public.promo_redemptions
    where promo_id = '50000000-0000-0000-0000-000000000001'),
  'the promo redemption is kept for usage reports but detached'
);

select ok(
  (select deleted_at is not null and email is null and full_name is null
          and first_name is null and phone is null
     from public.profiles where id = 'c0000000-0000-0000-0000-000000000001'),
  'the profile is scrubbed and tombstoned until the auth user is removed'
);

select is(
  pg_temp.sqlstate_of($$select public.delete_account_data('c0000000-0000-0000-0000-000000000001')$$),
  'P0002',
  'a second deletion of the same account is refused'
);

-- The server action then deletes the auth user; the profile cascades away.
delete from auth.users where id = 'c0000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.profiles where id = 'c0000000-0000-0000-0000-000000000001'),
  0,
  'deleting the auth user removes the profile'
);

select is(
  (select count(*)::int from public.orders where id in (
    '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002')),
  2,
  'the anonymised orders survive the auth user being deleted'
);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
insert into public.orders (user_id, location_id, idempotency_key)
values ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'del-test-3');

select is(
  pg_temp.sqlstate_of($$delete from auth.users where id = 'c0000000-0000-0000-0000-000000000002'$$),
  '23514',
  'a user with orders cannot be deleted around the anonymising flow'
);

select is(
  pg_temp.sqlstate_of($$
    insert into public.orders (user_id, location_id, idempotency_key)
    values (null, '10000000-0000-0000-0000-000000000001', 'del-test-4')
  $$),
  '23514',
  'an order cannot be created without an owner'
);

set local request.jwt.claims to '{"role": "authenticated", "sub": "c0000000-0000-0000-0000-000000000002"}';

select is(
  pg_temp.try_as('authenticated', $$
    insert into public.catering_requests (user_id, event_at, headcount, anonymized_at)
    values ('c0000000-0000-0000-0000-000000000002', now() + interval '10 days', 10, now())
  $$),
  '42501',
  'a customer cannot submit a pre-anonymised catering request to dodge the contact check'
);

reset request.jwt.claims;

-- Last admin
select is(
  pg_temp.sqlstate_of($$select public.delete_account_data('a0000000-0000-0000-0000-000000000001')$$),
  'DC001',
  'the last remaining admin cannot delete their own account'
);

select ok(
  (select deleted_at is null and role = 'admin'
     from public.profiles where id = 'a0000000-0000-0000-0000-000000000001'),
  'the refused admin is untouched'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('a0000000-0000-0000-0000-000000000002', 'boss2@drincup.test', '{"full_name": "Second Boss"}');
update public.profiles set role = 'admin' where id = 'a0000000-0000-0000-0000-000000000002';

select lives_ok(
  $$select public.delete_account_data('a0000000-0000-0000-0000-000000000001')$$,
  'with a second admin in place, an admin may delete their account'
);

select is(
  pg_temp.sqlstate_of($$select public.delete_account_data('a0000000-0000-0000-0000-000000000002')$$),
  'DC001',
  'a tombstoned admin does not count, so the remaining admin is now the last'
);

select * from finish();
rollback;

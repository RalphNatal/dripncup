-- ============================================================================
-- Phase 5: the email outbox. A status change writes the email it owes in the
-- same transaction; replays never owe a second one.
--
-- Run with `npm run test:db`. Rolled back at the end.
-- ============================================================================
begin;

select plan(16);

create function pg_temp.try_as(role_name text, claims text, sql text)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', claims, true);
  execute format('set local role %I', role_name);
  execute sql;
  reset role;
  return 'ok';
exception
  when others then
    return sqlstate;
end;
$$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('e0000000-0000-0000-0000-00000000000a', 'outbox-a@drincup.test', '{"full_name": "Kai A"}'),
  ('e0000000-0000-0000-0000-00000000000b', 'outbox-ready@drincup.test', '{"full_name": "Noe Ready"}'),
  ('e0000000-0000-0000-0000-00000000000c', 'outbox-staff@drincup.test', '{"full_name": "Staff"}');
update public.profiles set role = 'admin' where id = 'e0000000-0000-0000-0000-00000000000c';
update public.profiles set notification_prefs = notification_prefs || '{"order_ready_email": true}'
 where id = 'e0000000-0000-0000-0000-00000000000b';

insert into public.locations (id, type, name, slug)
values ('e1000000-0000-0000-0000-000000000001', 'cafe', 'Outbox Cafe', 'outbox-cafe');

create function pg_temp.pending_order(p_key text, p_user text default 'e0000000-0000-0000-0000-00000000000a')
returns uuid
language sql
as $$
  select order_id from public.create_checkout_order(
    jsonb_build_object(
      'user_id', p_user, 'location_id', 'e1000000-0000-0000-0000-000000000001',
      'pickup_type', 'asap', 'subtotal_cents', 600, 'discount_cents', 0, 'taxable_base_cents', 600,
      'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', 600,
      'customer_email', 'outbox-a@drincup.test', 'idempotency_key', p_key
    ),
    '[]'::jsonb
  );
$$;

create function pg_temp.emails(p_order uuid, p_kind text default null)
returns integer
language sql
as $$
  select count(*)::int from public.email_outbox where order_id = p_order and (p_kind is null or kind = p_kind)
$$;

create function pg_temp.oid(p_key text)
returns uuid
language sql
as $$ select id from public.orders where idempotency_key = p_key $$;

-- ---------------------------------------------------------------------------
-- The receipt: once, however often the payment is reported.
-- ---------------------------------------------------------------------------
select pg_temp.pending_order('outbox-1');
select is(pg_temp.emails(pg_temp.oid('outbox-1')), 0, 'a pending checkout owes no email');

select public.mark_order_paid(pg_temp.oid('outbox-1'), 'pi_outbox_1', 'ch_1', 600, 'usd');
select is(pg_temp.emails(pg_temp.oid('outbox-1'), 'order_receipt'), 1, 'placing the order queues one receipt, in the same transaction');

select is(public.mark_order_paid(pg_temp.oid('outbox-1'), 'pi_outbox_1', 'ch_1', 600, 'usd'), 'already_placed', 'a replayed payment is recognised');
select is(public.mark_order_paid(pg_temp.oid('outbox-1'), 'pi_outbox_1', 'ch_1', 600, 'usd'), 'already_placed', 'and again');
select is(pg_temp.emails(pg_temp.oid('outbox-1')), 1, 'replaying the Placed event queues no second receipt');

select is(
  (select status || ':' || attempts from public.email_outbox where order_id = pg_temp.oid('outbox-1')),
  'pending:0', 'the receipt waits for the sender');

-- ---------------------------------------------------------------------------
-- Ready: only for customers who asked.
-- ---------------------------------------------------------------------------
update public.orders set status = 'accepted' where id = pg_temp.oid('outbox-1');
update public.orders set status = 'preparing' where id = pg_temp.oid('outbox-1');
update public.orders set status = 'ready' where id = pg_temp.oid('outbox-1');
select is(pg_temp.emails(pg_temp.oid('outbox-1'), 'order_ready'), 0, 'no ready email by default');

select pg_temp.pending_order('outbox-ready', 'e0000000-0000-0000-0000-00000000000b');
select public.mark_order_paid(pg_temp.oid('outbox-ready'), 'pi_outbox_r', 'ch_r', 600, 'usd');
update public.orders set status = 'accepted' where id = pg_temp.oid('outbox-ready');
update public.orders set status = 'preparing' where id = pg_temp.oid('outbox-ready');
update public.orders set status = 'ready' where id = pg_temp.oid('outbox-ready');
select is(pg_temp.emails(pg_temp.oid('outbox-ready'), 'order_ready'), 1, 'a ready email for a customer who turned it on');

-- ---------------------------------------------------------------------------
-- Cancelled and refunded.
-- ---------------------------------------------------------------------------
select pg_temp.pending_order('outbox-2');
select public.mark_order_paid(pg_temp.oid('outbox-2'), 'pi_outbox_2', 'ch_2', 600, 'usd');
select public.cancel_order_for_refund(pg_temp.oid('outbox-2'), 'Espresso machine down', 'e0000000-0000-0000-0000-00000000000c');
select is(pg_temp.emails(pg_temp.oid('outbox-2'), 'order_cancelled'), 1, 'cancelling a paid order queues a cancellation email');
select public.apply_refund_state('pi_outbox_2', 600);
select is((select status::text from public.orders where id = pg_temp.oid('outbox-2')), 'refunded', 'the refund lands');
select is(pg_temp.emails(pg_temp.oid('outbox-2')) , 2, 'cancelled then refunded is one email (plus the receipt), not two');

select pg_temp.pending_order('outbox-3');
update public.orders set status = 'cancelled', cancellation_reason = 'expired' where id = pg_temp.oid('outbox-3');
select is(pg_temp.emails(pg_temp.oid('outbox-3')), 0, 'an expired, unpaid checkout owes nothing');

update public.orders set status = 'picked_up' where id = pg_temp.oid('outbox-1');
select public.apply_refund_state('pi_outbox_1', 600);
select is(pg_temp.emails(pg_temp.oid('outbox-1'), 'order_refunded'), 1, 'a refund after pickup queues a refund email');

-- ---------------------------------------------------------------------------
-- Who can touch the outbox.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.try_as('authenticated', '{"role": "authenticated", "sub": "e0000000-0000-0000-0000-00000000000a"}',
    $$select public.claim_email_outbox(10)$$),
  '42501', 'a customer cannot claim outbox rows');
select is(
  pg_temp.try_as('authenticated', '{"role": "authenticated", "sub": "e0000000-0000-0000-0000-00000000000a"}',
    $$insert into public.email_outbox (kind, dedupe_key) values ('order_receipt', 'spoof')$$),
  '42501', 'a customer cannot write to the outbox');

-- The sender claims each due row once.
select is(
  (select count(*)::int from public.claim_email_outbox(50) c
    where c.order_id in (pg_temp.oid('outbox-1'), pg_temp.oid('outbox-2'), pg_temp.oid('outbox-ready')))
  + (select count(*)::int from public.claim_email_outbox(50) c
    where c.order_id in (pg_temp.oid('outbox-1'), pg_temp.oid('outbox-2'), pg_temp.oid('outbox-ready'))),
  6, 'six emails owed, each claimed exactly once across two sender runs');

select * from finish();
rollback;

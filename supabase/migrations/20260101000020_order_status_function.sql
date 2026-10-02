-- ============================================================================
-- Phase 5, Part 0: staff change order status through one function, never by
-- writing to the table.
--
-- Until now the `orders_update_staff` policy let rostered staff UPDATE any
-- column of an order at their location. The transition trigger guarded
-- `status`, but nothing stopped a crafted request rewriting `total_cents`,
-- the cup name or the pickup time. Now:
--
--   * nobody but the service role may INSERT, UPDATE or DELETE orders,
--     order items, status history, payments or refunds
--   * advance_order_status()   staff and admins move an order along: status,
--                              its timestamp and a cancel reason, nothing else
--   * cancel_order_for_refund() the server's cancel-with-refund flow (service
--                              role), which is the only way to cancel an order
--                              that has been paid for
--
-- Both record who made the change in order_status_history.
-- ============================================================================

drop policy if exists orders_update_staff on public.orders;

-- Privileges as well as policies: with no policy an UPDATE already matches no
-- rows, but revoking makes it an error, so a missing policy can never quietly
-- become a permissive one later. SELECT stays (RLS decides which rows).
revoke insert, update, delete, truncate on public.orders               from anon, authenticated;
revoke insert, update, delete, truncate on public.order_items          from anon, authenticated;
revoke insert, update, delete, truncate on public.order_status_history from anon, authenticated;
revoke insert, update, delete, truncate on public.payments             from anon, authenticated;
revoke insert, update, delete, truncate on public.refunds              from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Who changed the status. auth.uid() for a signed-in caller; the service-role
-- functions below name the staff member in a transaction-local setting
-- instead, because a service-role session has no auth.uid(). Changes the
-- webhook or expiry job make have neither and are recorded with no actor
-- (the system).
-- ----------------------------------------------------------------------------
create or replace function public.record_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := coalesce(auth.uid(), nullif(current_setting('app.order_status_actor', true), '')::uuid);
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, actor);
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    values (
      new.id, old.status, new.status, actor,
      case when new.status = 'cancelled' then new.cancellation_reason end
    );
  end if;
  return new;
end;
$$;

-- True while the order holds money that has not been given back.
create or replace function public.order_has_captured_payment(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.payments p
     where p.order_id = p_order_id
       and p.status in ('succeeded', 'partially_refunded')
       and p.amount_cents > p.refunded_cents
  );
$$;

revoke execute on function public.order_has_captured_payment(uuid) from public, anon, authenticated;
grant execute on function public.order_has_captured_payment(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- advance_order_status: the staff queue's one write path into orders.
--
--   * the caller must be an admin, or staff rostered to the order's location
--     (anyone else, including for an order that does not exist, gets the same
--     42501, so the function cannot be used to probe order ids)
--   * only accepted, preparing, ready, picked_up and cancelled are reachable
--     here: placed belongs to the payment webhook, refunded to the refund flow
--   * the move must be one is_valid_order_transition() allows
--   * cancelling needs a reason, and is refused (DC002) while the order holds
--     money: that goes through cancel-with-refund on the server instead
--
-- Writes status, cancellation_reason and, through the transition trigger, the
-- matching timestamp. Nothing else on the row can change.
-- ----------------------------------------------------------------------------
create or replace function public.advance_order_status(
  p_order_id uuid,
  p_new_status public.order_status,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  o public.orders;
  reason text := nullif(trim(p_reason), '');
begin
  if caller is null
     or not exists (
       select 1 from public.profiles
        where id = caller and role in ('staff', 'admin') and deleted_at is null
     ) then
    raise exception 'Only staff can update orders' using errcode = 'insufficient_privilege';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found or not public.can_access_location(o.location_id) then
    raise exception 'Not authorised for this order' using errcode = 'insufficient_privilege';
  end if;

  if p_new_status not in ('accepted', 'preparing', 'ready', 'picked_up', 'cancelled') then
    raise exception 'Orders cannot be moved to % here', p_new_status
      using errcode = 'invalid_parameter_value';
  end if;

  if not public.is_valid_order_transition(o.status, p_new_status) then
    raise exception 'Invalid order status transition: % -> %', o.status, p_new_status
      using errcode = 'check_violation';
  end if;

  if p_new_status = 'cancelled' then
    if reason is null or char_length(reason) < 3 then
      raise exception 'A reason is required to cancel an order' using errcode = 'invalid_parameter_value';
    end if;
    if public.order_has_captured_payment(o.id) then
      raise exception 'This order has been paid for; cancel it with a refund'
        using errcode = 'DC002';
    end if;
  end if;

  update public.orders
     set status = p_new_status,
         cancellation_reason = case when p_new_status = 'cancelled' then left(reason, 500) else cancellation_reason end
   where id = o.id
  returning * into o;

  return o;
end;
$$;

revoke execute on function public.advance_order_status(uuid, public.order_status, text) from public, anon;
grant execute on function public.advance_order_status(uuid, public.order_status, text) to authenticated, service_role;

comment on function public.advance_order_status is
  'Staff/admin status change: status, its timestamp and a cancel reason only. Paid orders cancel through cancel_order_for_refund.';

-- ----------------------------------------------------------------------------
-- cancel_order_for_refund: step one of cancelOrderWithRefund()
-- (src/lib/orders/cancel.ts), which refunds straight after. Service role only;
-- the actor is checked here as well as in the server code. Returns:
--   'cancelled'        done; the caller refunds next
--   'not_found'        no such order
--   'forbidden'        the actor is not an admin or rostered staff
--   'not_cancellable'  the order is not placed, accepted, preparing or ready
--   'reason_required'  no reason given
-- ----------------------------------------------------------------------------
create or replace function public.cancel_order_for_refund(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
  actor public.profiles;
  reason text := nullif(trim(p_reason), '');
begin
  if reason is null or char_length(reason) < 3 then
    return 'reason_required';
  end if;

  select * into actor from public.profiles where id = p_actor_id and deleted_at is null;
  if not found or actor.role not in ('staff', 'admin') then
    return 'forbidden';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;

  if actor.role = 'staff' and not exists (
    select 1 from public.staff_locations where profile_id = actor.id and location_id = o.location_id
  ) then
    return 'forbidden';
  end if;

  if o.status not in ('placed', 'accepted', 'preparing', 'ready') then
    return 'not_cancellable';
  end if;

  perform set_config('app.order_status_actor', actor.id::text, true);
  update public.orders
     set status = 'cancelled', cancellation_reason = left(reason, 500)
   where id = o.id;
  perform set_config('app.order_status_actor', '', true);

  return 'cancelled';
end;
$$;

revoke execute on function public.cancel_order_for_refund(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_order_for_refund(uuid, text, uuid) to service_role;

comment on function public.cancel_order_for_refund is
  'Server-side cancel-with-refund, step one: cancels a placed..ready order and records the staff member. Service role only.';

-- ============================================================================
-- Business rules enforced in the database, so they hold no matter which
-- codepath (API route, webhook, admin action, psql) makes the change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Settings reader. SECURITY DEFINER so server code can read admin-only keys
-- through one auditable entry point.
-- ----------------------------------------------------------------------------
create or replace function public.get_setting(setting_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select value from public.settings where key = setting_key;
$$;

-- Order and catering numbers are column DEFAULTs, not triggers: see
-- next_order_number() in 20260101000010_orders.sql and
-- next_catering_number() in 20260101000013_catering.sql.

-- ----------------------------------------------------------------------------
-- Order status transitions.
--
-- The whole point is that an order cannot skip the queue: Placed cannot jump
-- straight to Picked Up. Cancellation is allowed from any pre-pickup state;
-- refund only from a terminal one.
-- ----------------------------------------------------------------------------
create or replace function public.is_valid_order_transition(
  from_status public.order_status,
  to_status public.order_status
)
returns boolean
language sql
immutable
as $$
  select case from_status
    when 'pending_payment' then to_status in ('placed', 'cancelled')
    when 'placed'          then to_status in ('accepted', 'cancelled')
    when 'accepted'        then to_status in ('preparing', 'cancelled')
    when 'preparing'       then to_status in ('ready', 'cancelled')
    when 'ready'           then to_status in ('picked_up', 'cancelled')
    when 'picked_up'       then to_status in ('refunded')
    when 'cancelled'       then to_status in ('refunded')
    when 'refunded'        then false
    else false
  end;
$$;

comment on function public.is_valid_order_transition is
  'Single source of truth for the order lifecycle; mirrored in TypeScript for the UI.';

-- Stamps the matching timestamp column and rejects illegal moves.
create or replace function public.enforce_order_status_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.is_valid_order_transition(old.status, new.status) then
    raise exception 'Invalid order status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  case new.status
    when 'placed'    then new.placed_at    := coalesce(new.placed_at, now());
    when 'accepted'  then new.accepted_at  := coalesce(new.accepted_at, now());
    when 'preparing' then new.preparing_at := coalesce(new.preparing_at, now());
    when 'ready'     then new.ready_at     := coalesce(new.ready_at, now());
    when 'picked_up' then new.picked_up_at := coalesce(new.picked_up_at, now());
    when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
    else null;
  end case;

  return new;
end;
$$;

create trigger orders_enforce_status_transition
  before update of status on public.orders
  for each row execute function public.enforce_order_status_transition();

-- Every status change lands in the audit table without the app remembering to.
create or replace function public.record_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif new.status is distinct from old.status then
    insert into public.order_status_history (order_id, from_status, to_status, changed_by, reason)
    values (new.id, old.status, new.status, auth.uid(), new.cancellation_reason);
  end if;
  return new;
end;
$$;

create trigger orders_record_status_change
  after insert or update of status on public.orders
  for each row execute function public.record_order_status_change();

-- ----------------------------------------------------------------------------
-- Order items are a snapshot: once the order leaves pending_payment they are
-- frozen. This is what guarantees a past receipt can never be rewritten.
-- ----------------------------------------------------------------------------
create or replace function public.freeze_order_items()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_status public.order_status;
begin
  select status into parent_status
    from public.orders
   where id = coalesce(new.order_id, old.order_id);

  if parent_status is distinct from 'pending_payment' then
    raise exception 'Order items are immutable once the order has been placed'
      using errcode = 'check_violation';
  end if;

  -- COALESCE(NEW, OLD) across record types is not dependable; branch instead.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger order_items_freeze
  before update or delete on public.order_items
  for each row execute function public.freeze_order_items();

-- ----------------------------------------------------------------------------
-- Catering requests cannot be submitted inside the configured lead time.
-- Admins editing an existing request are not re-checked.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_catering_lead_time()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lead_hours integer;
begin
  -- There is no direct jsonb -> integer cast; pull the scalar out as text.
  lead_hours := coalesce((public.get_setting('catering.min_lead_time_hours') #>> '{}')::integer, 72);

  if new.event_at < now() + make_interval(hours => lead_hours) then
    raise exception 'Catering requests need at least % hours notice', lead_hours
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger catering_requests_enforce_lead_time
  before insert on public.catering_requests
  for each row execute function public.enforce_catering_lead_time();

-- ----------------------------------------------------------------------------
-- Catering status transitions.
-- ----------------------------------------------------------------------------
create or replace function public.enforce_catering_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (case old.status
    when 'submitted' then new.status in ('quoted', 'cancelled')
    when 'quoted'    then new.status in ('confirmed', 'cancelled', 'quoted')
    when 'confirmed' then new.status in ('fulfilled', 'cancelled')
    when 'fulfilled' then false
    when 'cancelled' then false
    else false
  end) then
    raise exception 'Invalid catering status transition: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  case new.status
    when 'quoted'    then new.quoted_at    := coalesce(new.quoted_at, now());
    when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now());
    when 'fulfilled' then new.fulfilled_at := coalesce(new.fulfilled_at, now());
    when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
    else null;
  end case;

  return new;
end;
$$;

create trigger catering_requests_enforce_transition
  before update of status on public.catering_requests
  for each row execute function public.enforce_catering_transition();

revoke execute on function public.get_setting(text) from public;
grant execute on function public.get_setting(text) to authenticated, anon, service_role;

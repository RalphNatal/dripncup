-- ============================================================================
-- Phase 6: the staff dashboard.
--
--   access helpers          a roster row grants access only while the person
--                           is still staff (or admin) and not deleted
--   get_setting()           no longer callable by clients
--   advance_order_status()  repeating the move an order has already made is
--                           a no-op, so two baristas tapping the same button
--                           both succeed
--   locations.paused_*      pause online orders with an optional auto-resume
--   set_sold_out()          the sold-out toggle, with an audit log of who
--                           changed what and when
--   catering location       which counter prepares a catering request, and
--                           the staff prep list for today
--   staff_order_activity()  a ticket's history with names, and what a cancel
--                           would refund
--   staff.* settings        ticket colour thresholds and print sizes, which
--                           staff may read
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Access helpers.
--
-- Until now can_access_location() trusted staff_locations alone, so a barista
-- demoted to customer (or a deleted account) whose roster row was left
-- behind kept reading that counter's orders, pausing it and marking things
-- sold out. A roster row now counts only while the profile is staff, and a
-- deleted profile has no role at all.
-- ----------------------------------------------------------------------------
create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid() and deleted_at is null;
$$;

create or replace function public.can_access_location(target_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_admin()
    or (
      public.auth_role() = 'staff'
      and exists (
        select 1
        from public.staff_locations sl
        where sl.location_id = target_location_id
          and sl.profile_id = auth.uid()
      )
    );
$$;

-- get_setting() is SECURITY DEFINER so triggers can read admin-only keys, and
-- it was granted to anon and authenticated: anyone could read every setting,
-- public or not, through the API. Only the definer functions that use it
-- (running as the owner) and the server need it.
revoke execute on function public.get_setting(text) from public, anon, authenticated;
grant execute on function public.get_setting(text) to service_role;

-- ----------------------------------------------------------------------------
-- advance_order_status: unchanged, except that asking for the status the
-- order already has returns it untouched instead of failing the transition
-- check. Two baristas tapping "Ready" on the same ticket both succeed, and
-- the order is marked ready once (one history row, one email).
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

  -- Already there: someone else made this move first. Not an error.
  if o.status = p_new_status then
    return o;
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

-- ----------------------------------------------------------------------------
-- Pause online orders, optionally until a set time.
--
-- `paused_until` is read lazily: a location whose pause has run out is
-- treated as accepting orders by every reader (isAcceptingOrders() in
-- src/lib/locations/status.ts), so auto-resume needs no scheduled job and
-- cannot be late. `accepting_orders` itself stays false until someone next
-- touches the toggle.
-- ----------------------------------------------------------------------------
alter table public.locations
  add column paused_until timestamptz,
  add column paused_at    timestamptz,
  add column paused_by    uuid references public.profiles (id) on delete set null;

comment on column public.locations.paused_until is
  'When a pause ends by itself. Null while paused = until someone resumes. Ignored while accepting_orders is true.';

drop function if exists public.set_location_accepting_orders(uuid, boolean);

create or replace function public.set_location_accepting_orders(
  target_location_id uuid,
  accepting boolean,
  resume_at timestamptz default null
)
returns public.locations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated public.locations;
begin
  if not public.can_access_location(target_location_id) then
    raise exception 'Not authorised for this location' using errcode = 'insufficient_privilege';
  end if;

  if not accepting and resume_at is not null
     and (resume_at <= now() or resume_at > now() + interval '12 hours') then
    raise exception 'An automatic resume must be within the next 12 hours' using errcode = 'invalid_parameter_value';
  end if;

  update public.locations
     set accepting_orders = accepting,
         paused_until = case when accepting then null else resume_at end,
         paused_at    = case when accepting then null else now() end,
         paused_by    = case when accepting then null else auth.uid() end
   where id = target_location_id
  returning * into updated;

  if not found then
    raise exception 'Not authorised for this location' using errcode = 'insufficient_privilege';
  end if;

  return updated;
end;
$$;

revoke execute on function public.set_location_accepting_orders(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_location_accepting_orders(uuid, boolean, timestamptz) to authenticated, service_role;

comment on function public.set_location_accepting_orders is
  'Staff pause/resume toggle, optionally resuming by itself at resume_at; the only write path staff have into locations.';

-- ----------------------------------------------------------------------------
-- Sold out.
--
-- Staff change availability only through set_sold_out(); the table is no
-- longer writable by clients at all. Every change, whoever makes it, lands
-- in location_availability_log with the person who made it.
--
-- `available_from` is the automatic reset: "until end of day" stores the
-- location's next opening (computed by the dashboard, see
-- src/lib/staff/sold-out.ts), "until I turn it back on" stores null. Readers
-- already treat a row whose available_from has passed as available.
-- ----------------------------------------------------------------------------
drop policy if exists location_availability_staff_write on public.location_availability;
revoke insert, update, delete, truncate on public.location_availability from anon, authenticated;

create table public.location_availability_log (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations (id) on delete cascade,
  product_id         uuid references public.products (id) on delete cascade,
  modifier_option_id uuid references public.modifier_options (id) on delete cascade,
  action             text not null check (action in ('sold_out', 'available')),
  -- For sold_out: when it resets by itself; null = until turned back on.
  until              timestamptz,
  -- Null = the system (service role, a migration, the seed).
  actor              uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now()
);

create index location_availability_log_location_idx
  on public.location_availability_log (location_id, created_at desc);

alter table public.location_availability_log enable row level security;

create policy location_availability_log_select on public.location_availability_log
  for select to authenticated
  using (public.can_access_location(location_id));

revoke insert, update, delete, truncate on public.location_availability_log from anon, authenticated;

comment on table public.location_availability_log is
  'Append-only: who marked what sold out or back on, at which location, and when. Written by trigger.';

create or replace function public.log_location_availability()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := coalesce(auth.uid(), nullif(current_setting('app.availability_actor', true), '')::uuid);
begin
  if tg_op = 'DELETE' then
    insert into public.location_availability_log (location_id, product_id, modifier_option_id, action, actor)
    values (old.location_id, old.product_id, old.modifier_option_id, 'available', actor);
    return old;
  end if;

  if tg_op = 'UPDATE'
     and new.is_available is not distinct from old.is_available
     and new.available_from is not distinct from old.available_from then
    return new;
  end if;

  insert into public.location_availability_log (location_id, product_id, modifier_option_id, action, until, actor)
  values (
    new.location_id, new.product_id, new.modifier_option_id,
    case when new.is_available then 'available' else 'sold_out' end,
    case when new.is_available then null else new.available_from end,
    actor
  );
  return new;
end;
$$;

create trigger location_availability_log_changes
  after insert or update or delete on public.location_availability
  for each row execute function public.log_location_availability();

create or replace function public.set_sold_out(
  p_location_id uuid,
  p_product_id uuid default null,
  p_modifier_option_id uuid default null,
  p_sold_out boolean default true,
  p_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not public.can_access_location(p_location_id) then
    raise exception 'Not authorised for this location' using errcode = 'insufficient_privilege';
  end if;

  if (p_product_id is null) = (p_modifier_option_id is null) then
    raise exception 'Name exactly one product or option' using errcode = 'invalid_parameter_value';
  end if;
  if p_product_id is not null and not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'No such product' using errcode = 'invalid_parameter_value';
  end if;
  if p_modifier_option_id is not null and not exists (select 1 from public.modifier_options where id = p_modifier_option_id) then
    raise exception 'No such option' using errcode = 'invalid_parameter_value';
  end if;

  if not p_sold_out then
    delete from public.location_availability
     where location_id = p_location_id
       and (product_id = p_product_id or modifier_option_id = p_modifier_option_id);
    return;
  end if;

  if p_until is not null and (p_until <= now() or p_until > now() + interval '31 days') then
    raise exception 'The reset time must be within the next 31 days' using errcode = 'invalid_parameter_value';
  end if;

  if p_product_id is not null then
    insert into public.location_availability (location_id, product_id, is_available, available_from, updated_by)
    values (p_location_id, p_product_id, false, p_until, caller)
    on conflict (location_id, product_id) where product_id is not null
    do update set is_available = false, available_from = excluded.available_from, updated_by = caller, reason = null;
  else
    insert into public.location_availability (location_id, modifier_option_id, is_available, available_from, updated_by)
    values (p_location_id, p_modifier_option_id, false, p_until, caller)
    on conflict (location_id, modifier_option_id) where modifier_option_id is not null
    do update set is_available = false, available_from = excluded.available_from, updated_by = caller, reason = null;
  end if;
end;
$$;

revoke execute on function public.set_sold_out(uuid, uuid, uuid, boolean, timestamptz) from public, anon;
grant execute on function public.set_sold_out(uuid, uuid, uuid, boolean, timestamptz) to authenticated, service_role;

comment on function public.set_sold_out is
  'Staff sold-out toggle for one product or option at one location, until p_until (null = until turned back on).';

-- ----------------------------------------------------------------------------
-- Catering: which counter prepares it. Pickups and deliveries are made at the
-- cafe unless a request names another location, so a missing location
-- defaults to the cafe.
-- ----------------------------------------------------------------------------
alter table public.catering_requests
  add column location_id uuid references public.locations (id) on delete restrict;

create index catering_requests_location_event_idx on public.catering_requests (location_id, event_at);

create or replace function public.default_catering_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.location_id is null then
    select id into new.location_id
      from public.locations
     where type = 'cafe' and is_active
     order by sort_order, created_at
     limit 1;
  end if;
  return new;
end;
$$;

create trigger catering_requests_default_location
  before insert on public.catering_requests
  for each row execute function public.default_catering_location();

update public.catering_requests c
   set location_id = (
     select id from public.locations where type = 'cafe' order by sort_order, created_at limit 1
   )
 where c.location_id is null;

-- The prep list: confirmed requests on one Honolulu date at one location,
-- with only what the counter needs. No quote, budget or email: staff have no
-- read access to catering_requests itself.
create or replace function public.staff_catering_prep(
  p_location_id uuid,
  p_day date default null
)
returns table (
  id                   uuid,
  request_number       text,
  event_at             timestamptz,
  headcount            integer,
  fulfillment          public.fulfillment_type,
  delivery_address     text,
  contact_name         text,
  contact_phone        text,
  notes                text,
  custom_drink_request text,
  items                jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.request_number, c.event_at, c.headcount, c.fulfillment, c.delivery_address,
    c.contact_name, c.contact_phone, c.notes, c.custom_drink_request,
    coalesce((
      select jsonb_agg(
               jsonb_build_object('name', i.product_name, 'quantity', i.quantity, 'notes', i.notes)
               order by i.created_at, i.id)
        from public.catering_request_items i
       where i.catering_request_id = c.id
    ), '[]'::jsonb)
  from public.catering_requests c
  where public.can_access_location(p_location_id)
    and c.location_id = p_location_id
    and c.status = 'confirmed'
    and public.cafe_date(c.event_at) = coalesce(p_day, public.cafe_today())
  order by c.event_at;
$$;

revoke execute on function public.staff_catering_prep(uuid, date) from public, anon;
grant execute on function public.staff_catering_prep(uuid, date) to authenticated, service_role;

comment on function public.staff_catering_prep is
  'Confirmed catering requests for one location on one Honolulu date (default today): the staff prep list.';

-- ----------------------------------------------------------------------------
-- A ticket's detail view: every status change with who made it, and what a
-- cancel would refund. Staff cannot read profiles or payments directly, so
-- this hands out names and one amount, for orders at their own counter only.
-- ----------------------------------------------------------------------------
create or replace function public.staff_order_activity(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if not found or not public.can_access_location(o.location_id) then
    raise exception 'Not authorised for this order' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'history', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'from_status', h.from_status,
                 'to_status', h.to_status,
                 'at', h.created_at,
                 'reason', h.reason,
                 'actor_name', case
                   when h.changed_by is null then null
                   else coalesce(nullif(p.first_name, ''), nullif(split_part(p.full_name, ' ', 1), ''), 'Staff')
                 end,
                 'actor_role', p.role
               )
               order by h.created_at, h.to_status, h.id)
        from public.order_status_history h
        left join public.profiles p on p.id = h.changed_by
       where h.order_id = o.id
    ), '[]'::jsonb),
    'refundable_cents', coalesce((
      select sum(greatest(pay.amount_cents - pay.refunded_cents, 0))
        from public.payments pay
       where pay.order_id = o.id and pay.status in ('succeeded', 'partially_refunded')
    ), 0)
  );
end;
$$;

revoke execute on function public.staff_order_activity(uuid) from public, anon;
grant execute on function public.staff_order_activity(uuid) to authenticated, service_role;

comment on function public.staff_order_activity is
  'Status history with actor names, and the refundable amount, for one order at a counter the caller works.';

-- ----------------------------------------------------------------------------
-- Staff settings. Not public, but staff may read the staff.* keys.
-- ----------------------------------------------------------------------------
insert into public.settings (key, value, description, is_public) values
  ('staff.ticket_warning_minutes', '5'::jsonb,
   'A ticket turns amber this many minutes after its estimated ready time.', false),
  ('staff.ticket_late_minutes', '10'::jsonb,
   'A ticket turns red this many minutes after its estimated ready time.', false),
  ('staff.new_order_repeat_seconds', '15'::jsonb,
   'The new-order chime repeats this often until someone acknowledges the order.', false),
  ('staff.receipt_width_mm', '80'::jsonb,
   'Paper width of the counter receipt printer, for printed tickets.', false),
  ('staff.label_width_mm', '57'::jsonb,
   'Cup label width in millimetres (one label per drink).', false),
  ('staff.label_height_mm', '32'::jsonb,
   'Cup label height in millimetres.', false)
on conflict (key) do nothing;

drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (is_public or public.is_admin() or (key like 'staff.%' and public.is_staff()));

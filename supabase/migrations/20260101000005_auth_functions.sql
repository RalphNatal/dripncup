-- ============================================================================
-- Role and permission helpers.
--
-- All of these are SECURITY DEFINER so they can read `profiles` and
-- `staff_locations` without tripping those tables' own RLS policies (which
-- would recurse). Every policy in the schema calls these rather than
-- re-querying profiles inline.
-- ============================================================================

create or replace function public.auth_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.auth_role() = 'admin', false);
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.auth_role() in ('staff', 'admin'), false);
$$;

-- Admins reach every location; baristas only the ones they are rostered to.
create or replace function public.can_access_location(target_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    public.is_admin()
    or exists (
      select 1
      from public.staff_locations sl
      where sl.location_id = target_location_id
        and sl.profile_id = auth.uid()
    );
$$;

-- Lock these down: they are definer functions, so only real sessions may call
-- them. (revoke from public, grant back to the two session roles.)
revoke execute on function public.auth_role() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_staff() from public;
revoke execute on function public.can_access_location(uuid) from public;

grant execute on function public.auth_role() to authenticated, anon, service_role;
grant execute on function public.is_admin() to authenticated, anon, service_role;
grant execute on function public.is_staff() to authenticated, anon, service_role;
grant execute on function public.can_access_location(uuid) to authenticated, anon, service_role;

comment on function public.auth_role is 'Role of the calling user; SECURITY DEFINER to avoid RLS recursion on profiles.';
comment on function public.can_access_location is 'True when the caller is an admin or rostered staff for the given location.';

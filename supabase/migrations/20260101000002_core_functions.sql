-- ============================================================================
-- Helper functions that depend on no application table.
-- Role/permission helpers live in 20260101000005_auth_functions.sql because
-- a LANGUAGE sql body is validated at CREATE time and therefore cannot
-- reference tables that do not exist yet.
-- ============================================================================

-- Keeps `updated_at` honest without the app having to remember.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Everything time-related in this app is reasoned about in cafe-local time.
-- Vercel runs in UTC, so we never rely on the server's default zone.
create or replace function public.cafe_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Pacific/Honolulu')::date;
$$;

-- Wall-clock time at the cafe, for comparing against location_hours.
create or replace function public.cafe_clock()
returns time
language sql
stable
as $$
  select (now() at time zone 'Pacific/Honolulu')::time;
$$;

comment on function public.cafe_today is 'Current calendar date in Pacific/Honolulu (HST, UTC-10, no DST).';
comment on function public.cafe_clock is 'Current wall-clock time in Pacific/Honolulu.';

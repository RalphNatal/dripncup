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

-- The Honolulu calendar date containing an instant. 23:30 HST on the 14th is
-- 09:30 UTC on the 15th, and this still answers the 14th.
create or replace function public.cafe_date(instant timestamptz)
returns date
language sql
stable
as $$
  select (instant at time zone 'Pacific/Honolulu')::date;
$$;

create or replace function public.cafe_today()
returns date
language sql
stable
as $$
  select public.cafe_date(now());
$$;

-- Wall-clock time at the cafe, for comparing against location_hours.
create or replace function public.cafe_clock()
returns time
language sql
stable
as $$
  select (now() at time zone 'Pacific/Honolulu')::time;
$$;

comment on function public.cafe_date is 'Calendar date in Pacific/Honolulu for the given instant.';
comment on function public.cafe_today is 'Current calendar date in Pacific/Honolulu (HST, UTC-10, no DST).';
comment on function public.cafe_clock is 'Current wall-clock time in Pacific/Honolulu.';

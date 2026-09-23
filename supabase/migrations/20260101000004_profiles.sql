-- ============================================================================
-- Profiles mirror auth.users and carry the role that every RLS policy reads.
-- ============================================================================

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text,
  full_name           text,
  -- Shown on barista tickets; kept separate so the queue stays first-name only.
  first_name          text,
  phone               text,
  role                public.user_role not null default 'customer',

  -- Off by default, per the privacy requirements.
  marketing_opt_in    boolean not null default false,
  sms_opt_in          boolean not null default false,
  notification_prefs  jsonb not null default '{"order_ready_push": true, "order_ready_email": true}'::jsonb,

  -- Denormalised running balance, maintained by a trigger on
  -- loyalty_transactions so the ledger stays the source of truth.
  loyalty_points      integer not null default 0 check (loyalty_points >= 0),
  -- Encoded in the member QR on the account page.
  member_code         text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),

  -- Set by "delete my account"; the row is retained only to keep historical
  -- orders referentially intact, with the personal fields scrubbed.
  deleted_at          timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);
create index profiles_email_idx on public.profiles (lower(email));

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Which baristas can see which queues. Admins bypass this entirely.
-- ----------------------------------------------------------------------------
create table public.staff_locations (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (profile_id, location_id)
);

create index staff_locations_location_idx on public.staff_locations (location_id);

-- ----------------------------------------------------------------------------
-- Create a profile whenever Supabase Auth creates a user. Runs as definer so
-- it works during sign-up before any session exists.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Metadata is client-supplied, so only harmless fields are read from it and
  -- the opt-in is true only when explicitly sent as true. `role` is never
  -- taken from here: everyone starts as a customer.
  insert into public.profiles (id, email, full_name, first_name, phone, marketing_opt_in)
  values (
    new.id,
    new.email,
    nullif(left(new.raw_user_meta_data ->> 'full_name', 100), ''),
    nullif(left(split_part(coalesce(new.raw_user_meta_data ->> 'full_name', ''), ' ', 1), 30), ''),
    nullif(left(new.raw_user_meta_data ->> 'phone', 32), ''),
    coalesce(new.raw_user_meta_data -> 'marketing_opt_in' = 'true'::jsonb, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- Role escalation guard: only an admin may change `role`. Customers can edit
-- their own profile, so without this a customer could promote themselves.
-- ----------------------------------------------------------------------------
create or replace function public.guard_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    -- auth.uid() is null for the service role / SQL editor, which is allowed.
    if auth.uid() is not null
       and coalesce((select p.role from public.profiles p where p.id = auth.uid()), 'customer') <> 'admin' then
      raise exception 'Only an administrator may change a profile role';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role_change
  before update on public.profiles
  for each row execute function public.guard_profile_role_change();

comment on table public.profiles is 'Application profile for each auth.users row; `role` drives all RLS.';
comment on column public.profiles.member_code is 'Short code rendered as the member QR for future in-store scanning.';

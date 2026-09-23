-- ============================================================================
-- Locations: the Kapiolani Blvd cafe plus time-boxed pop-up event booths.
-- A cart, an order and a sold-out flag all belong to exactly one location.
-- ============================================================================

create table public.locations (
  id                  uuid primary key default gen_random_uuid(),
  type                public.location_type not null default 'cafe',
  name                text not null,
  slug                text not null unique,
  description         text,

  address_line1       text,
  address_line2       text,
  city                text not null default 'Honolulu',
  state               text not null default 'HI',
  postal_code         text,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),
  phone               text,

  -- Shown on the location card and the confirmation screen.
  pickup_instructions text,
  -- Baseline minutes from "accepted" to "ready"; ASAP quotes are built on this.
  prep_time_minutes   integer not null default 10 check (prep_time_minutes between 0 and 240),
  timezone            text not null default 'Pacific/Honolulu',

  image_url           text,
  sort_order          integer not null default 0,
  is_active           boolean not null default true,
  -- The staff "pause online orders" toggle for rush periods.
  accepting_orders    boolean not null default true,

  -- Events only: the window during which the booth exists and can take orders.
  starts_at           timestamptz,
  ends_at             timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint locations_event_window_required check (
    type <> 'event' or (starts_at is not null and ends_at is not null)
  ),
  constraint locations_event_window_ordered check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

create index locations_type_active_idx on public.locations (type, is_active);
create index locations_event_window_idx on public.locations (starts_at, ends_at) where type = 'event';

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Weekly opening hours. Multiple rows per day are allowed so a location can
-- have split hours (e.g. a morning and an evening service).
-- ----------------------------------------------------------------------------
create table public.location_hours (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.locations (id) on delete cascade,
  -- 0 = Sunday .. 6 = Saturday, matching JS getDay().
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  opens_at     time not null,
  closes_at    time not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint location_hours_ordered check (closes_at > opens_at)
);

create index location_hours_location_day_idx on public.location_hours (location_id, day_of_week);

create trigger location_hours_set_updated_at
  before update on public.location_hours
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- One-off closures and holiday hours.
--   is_closed = true  -> shut for the whole day, regardless of location_hours
--   is_closed = false -> replace that day's hours with opens_at/closes_at
-- A null location_id applies the override to every location.
-- ----------------------------------------------------------------------------
create table public.closures (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid references public.locations (id) on delete cascade,
  closure_date date not null,
  is_closed    boolean not null default true,
  opens_at     time,
  closes_at    time,
  reason       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint closures_holiday_hours_complete check (
    is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at)
  )
);

create unique index closures_unique_per_location_date
  on public.closures (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid), closure_date);
create index closures_date_idx on public.closures (closure_date);

create trigger closures_set_updated_at
  before update on public.closures
  for each row execute function public.set_updated_at();

comment on table public.closures is 'One-off closures and holiday-hour overrides; null location_id = all locations.';

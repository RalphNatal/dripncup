-- ============================================================================
-- Per-location availability overrides and event menus.
--
-- The catalog says what exists; these two tables say what a given counter can
-- actually make right now.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Sold-out overrides. A row exists only when something is NOT available, so the
-- absence of a row means "available". Exactly one of product_id /
-- modifier_option_id is set.
-- ----------------------------------------------------------------------------
create table public.location_availability (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references public.locations (id) on delete cascade,
  product_id         uuid references public.products (id) on delete cascade,
  modifier_option_id uuid references public.modifier_options (id) on delete cascade,
  is_available       boolean not null default false,
  reason             text,
  -- Optional auto-expiry, so "out of oat milk today" clears itself.
  available_from     timestamptz,
  updated_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint location_availability_one_target check (
    (product_id is not null and modifier_option_id is null)
    or (product_id is null and modifier_option_id is not null)
  )
);

create unique index location_availability_product_idx
  on public.location_availability (location_id, product_id) where product_id is not null;
create unique index location_availability_option_idx
  on public.location_availability (location_id, modifier_option_id) where modifier_option_id is not null;

create trigger location_availability_set_updated_at
  before update on public.location_availability
  for each row execute function public.set_updated_at();

comment on table public.location_availability is
  'Sold-out overrides per location. No row = available. Baristas toggle these from /staff.';

-- ----------------------------------------------------------------------------
-- Event menus. A pop-up booth carries a subset of the catalog; if an event has
-- no rows here the app treats it as "no menu published yet", not "everything".
-- ----------------------------------------------------------------------------
create table public.event_menu_items (
  location_id uuid not null references public.locations (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),

  primary key (location_id, product_id)
);

create index event_menu_items_product_idx on public.event_menu_items (product_id);

comment on table public.event_menu_items is
  'Limited menu for a pop-up event location. Empty = event menu not published.';

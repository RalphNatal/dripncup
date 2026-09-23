-- ============================================================================
-- Seasonal / limited-time collections.
-- Show-and-hide is purely a function of starts_at / ends_at, so nobody has to
-- remember to flip a switch when a season ends.
-- ============================================================================

create table public.collections (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique,
  description      text,
  banner_image_url text,

  -- Optional per-collection accent that overrides the brand accent on the
  -- banner and chips. Stored as a CSS colour string.
  accent_color     text,

  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  -- Manual kill switch; the date window still has to be open as well.
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint collections_window_ordered check (ends_at > starts_at)
);

create index collections_window_idx on public.collections (starts_at, ends_at) where is_active;

create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

create table public.collection_products (
  collection_id uuid not null references public.collections (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete cascade,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),

  primary key (collection_id, product_id)
);

create index collection_products_product_idx on public.collection_products (product_id);

comment on column public.collections.accent_color is
  'Optional CSS colour overriding the brand accent for this collection banner.';

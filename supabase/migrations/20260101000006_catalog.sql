-- ============================================================================
-- Menu catalog. Everything the customisation sheet renders comes from here --
-- there are no hardcoded modifiers anywhere in the UI.
-- ============================================================================

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  description text,
  image_url   text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index categories_active_sort_idx on public.categories (is_active, sort_order);

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Products. base_price_cents is the fallback for items with no size options
-- (a pastry, say); sized items price off product_sizes instead.
-- ----------------------------------------------------------------------------
create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  category_id          uuid references public.categories (id) on delete set null,
  name                 text not null,
  slug                 text not null unique,
  description          text,
  image_url            text,
  base_price_cents     integer not null default 0 check (base_price_cents >= 0),

  allergens            public.allergen[] not null default '{}',
  dietary_tags         public.dietary_tag[] not null default '{}',
  calories             integer check (calories is null or calories >= 0),

  -- Can this item appear in the catering request builder?
  is_catering_eligible boolean not null default false,
  sort_order           integer not null default 0,
  is_active            boolean not null default true,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index products_category_idx on public.products (category_id, sort_order);
create index products_active_idx on public.products (is_active);
create index products_catering_idx on public.products (is_catering_eligible) where is_catering_eligible;

-- Backs the menu search box.
create index products_search_idx on public.products
  using gin (to_tsvector('english', name || ' ' || coalesce(description, '')));

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Sizes carry their own absolute price (not a delta), because a large cold brew
-- is not reliably "small plus a fixed amount".
-- ----------------------------------------------------------------------------
create table public.product_sizes (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  name        text not null,
  price_cents integer not null check (price_cents >= 0),
  volume_oz   integer check (volume_oz is null or volume_oz > 0),
  is_default  boolean not null default false,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (product_id, name)
);

create index product_sizes_product_idx on public.product_sizes (product_id, sort_order);

-- At most one default size per product.
create unique index product_sizes_one_default_idx
  on public.product_sizes (product_id) where is_default;

create trigger product_sizes_set_updated_at
  before update on public.product_sizes
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Modifier groups are reusable across products (one "Milk" group, linked to
-- every espresso drink). Per-product overrides live on the join table.
-- ----------------------------------------------------------------------------
create table public.modifier_groups (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  description    text,
  selection_type public.modifier_selection_type not null default 'single',
  is_required    boolean not null default false,
  min_selections integer not null default 0 check (min_selections >= 0),
  max_selections integer check (max_selections is null or max_selections > 0),

  -- Allows one option to be chosen more than once: 3 pumps of vanilla,
  -- 2 extra shots. A value of 1 means a plain on/off toggle.
  max_quantity_per_option integer not null default 1 check (max_quantity_per_option >= 1),

  -- What one unit of quantity is called in the UI and on tickets ("pump",
  -- "shot"). Null reads as a plain count ("x 2").
  quantity_unit  text check (quantity_unit is null or char_length(quantity_unit) between 1 and 20),

  -- true:  the option's price_delta_cents is charged per unit (2 shots = 2x).
  -- false: charged once however many units (a flavour costs the same at
  --        1 pump or 4). Lets the real menu price either way with data only.
  charge_per_quantity boolean not null default true,

  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint modifier_groups_min_max_ordered check (
    max_selections is null or max_selections >= min_selections
  ),
  constraint modifier_groups_required_has_min check (
    not is_required or min_selections >= 1
  ),
  constraint modifier_groups_single_select_max check (
    selection_type <> 'single' or max_selections is null or max_selections = 1
  )
);

create trigger modifier_groups_set_updated_at
  before update on public.modifier_groups
  for each row execute function public.set_updated_at();

create table public.modifier_options (
  id                 uuid primary key default gen_random_uuid(),
  modifier_group_id  uuid not null references public.modifier_groups (id) on delete cascade,
  name               text not null,
  description        text,

  -- Added to the unit price, per selected quantity. May be negative
  -- (for example a discount for bringing your own cup).
  price_delta_cents  integer not null default 0,

  is_default         boolean not null default false,

  -- Caps this specific option below the group's max_quantity_per_option.
  max_quantity       integer not null default 1 check (max_quantity >= 1),

  allergens          public.allergen[] not null default '{}',
  sort_order         integer not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (modifier_group_id, name)
);

create index modifier_options_group_idx on public.modifier_options (modifier_group_id, sort_order);

create trigger modifier_options_set_updated_at
  before update on public.modifier_options
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Product to modifier-group linking, with optional per-product overrides.
-- A null override means "inherit the group's own setting".
-- ----------------------------------------------------------------------------
create table public.product_modifier_groups (
  product_id              uuid not null references public.products (id) on delete cascade,
  modifier_group_id       uuid not null references public.modifier_groups (id) on delete cascade,
  sort_order              integer not null default 0,
  override_is_required    boolean,
  override_min_selections integer check (override_min_selections is null or override_min_selections >= 0),
  override_max_selections integer check (override_max_selections is null or override_max_selections > 0),

  -- Conditional group: shown, validated and charged only while this option
  -- (from another group on the same product) is selected -- e.g. Ice only
  -- when Iced is chosen. Null = always shown. Per product, because a drink
  -- that is only ever served cold shows Ice unconditionally.
  visible_when_option_id  uuid references public.modifier_options (id) on delete set null,

  created_at              timestamptz not null default now(),

  primary key (product_id, modifier_group_id),

  constraint pmg_override_min_max_ordered check (
    override_max_selections is null
    or override_min_selections is null
    or override_max_selections >= override_min_selections
  )
);

create index product_modifier_groups_group_idx on public.product_modifier_groups (modifier_group_id);
create index product_modifier_groups_condition_idx
  on public.product_modifier_groups (visible_when_option_id) where visible_when_option_id is not null;

-- The controlling option must belong to a different group that is linked to
-- the same product; otherwise the condition could never be met. Deferred, so
-- a product's links can be inserted in any order within one transaction.
create or replace function public.check_product_modifier_condition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.visible_when_option_id is null then
    return null;
  end if;

  if not exists (
    select 1
      from public.modifier_options o
      join public.product_modifier_groups link
        on link.modifier_group_id = o.modifier_group_id
       and link.product_id = new.product_id
     where o.id = new.visible_when_option_id
       and o.modifier_group_id <> new.modifier_group_id
  ) then
    raise exception 'visible_when_option_id must be an option from another modifier group on the same product'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger product_modifier_groups_condition_valid
  after insert or update of visible_when_option_id on public.product_modifier_groups
  deferrable initially deferred
  for each row execute function public.check_product_modifier_condition();

comment on table public.modifier_groups is 'Data-driven customisation groups; the UI renders whatever is here.';
comment on column public.modifier_groups.max_quantity_per_option is 'Enables pump counts and extra shots; 1 = simple toggle.';
comment on column public.modifier_groups.charge_per_quantity is 'true = price delta per unit (shots); false = once per option (flavours).';
comment on column public.product_modifier_groups.visible_when_option_id is
  'Show this group only while the given option is selected (e.g. Ice when Iced).';

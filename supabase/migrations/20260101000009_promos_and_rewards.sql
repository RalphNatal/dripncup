-- ============================================================================
-- Promo codes and Overflow Rewards tiers.
--
-- Note the RLS posture (applied later): promos are deliberately NOT readable by
-- customers. A customer types a code and the server validates it; making the
-- table public would let anyone enumerate every active discount.
-- ============================================================================

create table public.promos (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null,
  description        text,
  type               public.promo_type not null,

  -- Exactly one of these is used, per `type`.
  percent            numeric(5, 2) check (percent is null or (percent > 0 and percent <= 100)),
  amount_cents       integer check (amount_cents is null or amount_cents > 0),

  min_spend_cents    integer not null default 0 check (min_spend_cents >= 0),
  -- Caps a percentage discount so "50% off" cannot run away on a catering-sized cart.
  max_discount_cents integer check (max_discount_cents is null or max_discount_cents > 0),

  usage_limit        integer check (usage_limit is null or usage_limit > 0),
  per_user_limit     integer check (per_user_limit is null or per_user_limit > 0),
  times_used         integer not null default 0 check (times_used >= 0),

  starts_at          timestamptz not null default now(),
  ends_at            timestamptz,
  is_active          boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint promos_value_matches_type check (
    (type = 'percent' and percent is not null and amount_cents is null)
    or (type = 'fixed' and amount_cents is not null and percent is null)
  ),
  constraint promos_window_ordered check (ends_at is null or ends_at > starts_at)
);

-- Codes are matched case-insensitively.
create unique index promos_code_unique_idx on public.promos (upper(code));

create trigger promos_set_updated_at
  before update on public.promos
  for each row execute function public.set_updated_at();

comment on table public.promos is
  'Promo codes. Not customer-readable by design; validation happens server-side.';

-- ----------------------------------------------------------------------------
-- One row per successful application. The unique constraint on (promo, order)
-- is what stops a retried checkout from double-counting a limited code.
-- ----------------------------------------------------------------------------
create table public.promo_redemptions (
  id           uuid primary key default gen_random_uuid(),
  promo_id     uuid not null references public.promos (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- FK added in the orders migration, which runs after this one.
  order_id     uuid not null,
  amount_cents integer not null check (amount_cents >= 0),
  created_at   timestamptz not null default now(),

  unique (promo_id, order_id)
);

create index promo_redemptions_user_idx on public.promo_redemptions (user_id, promo_id);

-- ----------------------------------------------------------------------------
-- Overflow Rewards tiers.
-- ----------------------------------------------------------------------------
create table public.rewards (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  description            text,
  points_cost            integer not null check (points_cost > 0),
  type                   public.reward_type not null,

  -- Used by amount_off / free_item valuation.
  value_cents            integer check (value_cents is null or value_cents > 0),
  -- Used by percent_off.
  percent                numeric(5, 2) check (percent is null or (percent > 0 and percent <= 100)),

  -- Empty array = applies to anything. Otherwise the reward is limited to
  -- these products or categories.
  applicable_product_ids  uuid[] not null default '{}',
  applicable_category_ids uuid[] not null default '{}',

  image_url              text,
  sort_order             integer not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint rewards_value_matches_type check (
    (type = 'percent_off' and percent is not null)
    or (type <> 'percent_off' and percent is null)
  )
);

create index rewards_active_idx on public.rewards (is_active, sort_order);

create trigger rewards_set_updated_at
  before update on public.rewards
  for each row execute function public.set_updated_at();

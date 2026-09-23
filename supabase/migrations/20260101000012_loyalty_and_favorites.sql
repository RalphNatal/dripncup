-- ============================================================================
-- Overflow Rewards ledger and saved favourite drinks.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Append-only points ledger. profiles.loyalty_points is a cached sum of this,
-- kept in step by the trigger below -- the ledger is always the truth.
--   earn    (+) credited when an order is marked picked_up
--   redeem  (-) spending points on a reward
--   reverse (-) clawing back an earn after a cancellation or refund
--   adjust  (+/-) manual admin correction
-- ----------------------------------------------------------------------------
create table public.loyalty_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  order_id    uuid references public.orders (id) on delete set null,
  reward_id   uuid references public.rewards (id) on delete set null,
  type        public.loyalty_transaction_type not null,
  -- Signed: positive credits, negative debits.
  points      integer not null check (points <> 0),
  description text,
  created_at  timestamptz not null default now(),

  constraint loyalty_sign_matches_type check (
    (type = 'earn' and points > 0)
    or (type = 'redeem' and points < 0)
    or (type = 'reverse' and points < 0)
    or (type = 'adjust')
  )
);

create index loyalty_transactions_user_idx on public.loyalty_transactions (user_id, created_at desc);
-- One earn row per order, so a replayed webhook cannot double-credit.
create unique index loyalty_transactions_one_earn_per_order_idx
  on public.loyalty_transactions (order_id) where type = 'earn' and order_id is not null;

create or replace function public.apply_loyalty_transaction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles
       set loyalty_points = greatest(0, loyalty_points + new.points)
     where id = new.user_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.profiles
       set loyalty_points = greatest(0, loyalty_points - old.points)
     where id = old.user_id;
    return old;
  end if;
  return null;
end;
$$;

create trigger loyalty_transactions_apply
  after insert or delete on public.loyalty_transactions
  for each row execute function public.apply_loyalty_transaction();

comment on table public.loyalty_transactions is
  'Append-only points ledger; profiles.loyalty_points is a cached sum maintained by trigger.';

-- ----------------------------------------------------------------------------
-- "My usual" -- a saved, fully customised drink the customer names themselves.
-- Stores the same modifier shape as order_items so one can be built from the
-- other, and is re-validated against the live menu when added to a cart.
-- ----------------------------------------------------------------------------
create table public.favorites (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),

  product_id      uuid not null references public.products (id) on delete cascade,
  product_size_id uuid references public.product_sizes (id) on delete set null,
  -- Same shape as order_items.modifiers.
  modifiers       jsonb not null default '[]'::jsonb,
  quantity        integer not null default 1 check (quantity > 0 and quantity <= 99),
  special_instructions text check (special_instructions is null or char_length(special_instructions) <= 100),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (user_id, name)
);

create index favorites_user_idx on public.favorites (user_id, created_at desc);

create trigger favorites_set_updated_at
  before update on public.favorites
  for each row execute function public.set_updated_at();

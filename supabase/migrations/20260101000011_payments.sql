-- ============================================================================
-- Payments.
--
-- Deliberately provider-agnostic column names: `provider` plus opaque
-- `provider_*_id` strings, so swapping Stripe for Square later is a data
-- change rather than a schema change. Card data never lands here -- only
-- Stripe's identifiers and status.
--
-- Nothing outside server code ever writes to this table; the Stripe webhook
-- (service role) is the only writer.
-- ============================================================================

create table public.payments (
  id                         uuid primary key default gen_random_uuid(),
  order_id                   uuid not null references public.orders (id) on delete cascade,

  provider                   text not null default 'stripe',
  provider_payment_intent_id text unique,
  provider_charge_id         text,
  provider_customer_id       text,

  status                     public.payment_status not null default 'requires_payment',

  amount_cents               integer not null check (amount_cents >= 0),
  -- Mirrored from the order so payout reconciliation does not need a join.
  tip_cents                  integer not null default 0 check (tip_cents >= 0),
  refunded_cents             integer not null default 0 check (refunded_cents >= 0),
  currency                   text not null default 'usd',

  -- Last webhook payload, for support and dispute forensics.
  raw                        jsonb,

  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint payments_refund_within_amount check (refunded_cents <= amount_cents)
);

create index payments_order_idx on public.payments (order_id);
create index payments_status_idx on public.payments (status);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

comment on table public.payments is
  'Provider-agnostic payment records. Written only by server code holding the service role.';

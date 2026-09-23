-- ============================================================================
-- Catering requests.
--
-- Workflow: submitted -> quoted -> confirmed -> fulfilled, with cancelled
-- reachable from anywhere before fulfilment. The customer creates the request;
-- only an admin moves it forward.
-- ============================================================================

-- Catering references look like CAT-260923-004. Shares daily_counters with
-- order numbers; see 20260101000010_orders.sql.
create or replace function public.next_catering_number()
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select 'CAT-'
    || to_char(public.cafe_today(), 'YYMMDD')
    || '-'
    || lpad(public.next_daily_number('catering')::text, 3, '0');
$$;

revoke execute on function public.next_catering_number() from public, anon;
grant execute on function public.next_catering_number() to authenticated, service_role;

create table public.catering_requests (
  id                  uuid primary key default gen_random_uuid(),
  -- Short human reference used in emails, e.g. CAT-260923-004.
  request_number      text not null unique default public.next_catering_number()
                      check (request_number <> ''),

  user_id             uuid not null references public.profiles (id) on delete restrict,

  contact_name        text not null,
  contact_email       text not null,
  contact_phone       text,

  event_at            timestamptz not null,
  headcount           integer not null check (headcount > 0),
  fulfillment         public.fulfillment_type not null default 'pickup',
  delivery_address    text,

  budget_cents        integer check (budget_cents is null or budget_cents >= 0),
  notes               text,
  -- "A custom signature drink for my event" free-text brief.
  custom_drink_request text,

  status              public.catering_status not null default 'submitted',

  -- Filled in by the admin at the quoting step.
  quote_amount_cents  integer check (quote_amount_cents is null or quote_amount_cents >= 0),
  quote_notes         text,
  payment_link_url    text,

  quoted_at           timestamptz,
  confirmed_at        timestamptz,
  fulfilled_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint catering_delivery_needs_address check (
    fulfillment <> 'delivery' or delivery_address is not null
  ),
  constraint catering_quoted_needs_amount check (
    status not in ('quoted', 'confirmed', 'fulfilled') or quote_amount_cents is not null
  )
);

create index catering_requests_user_idx on public.catering_requests (user_id, created_at desc);
create index catering_requests_status_idx on public.catering_requests (status, event_at);
-- Backs the admin calendar view.
create index catering_requests_event_idx on public.catering_requests (event_at);

create trigger catering_requests_set_updated_at
  before update on public.catering_requests
  for each row execute function public.set_updated_at();

create table public.catering_request_items (
  id                   uuid primary key default gen_random_uuid(),
  catering_request_id  uuid not null references public.catering_requests (id) on delete cascade,
  -- Null when the line is a free-text custom drink rather than a menu item.
  product_id           uuid references public.products (id) on delete set null,
  product_name         text not null,
  quantity             integer not null default 1 check (quantity > 0),
  notes                text,
  created_at           timestamptz not null default now()
);

create index catering_request_items_request_idx on public.catering_request_items (catering_request_id);

comment on table public.catering_requests is
  'Customer-submitted catering enquiries; minimum lead time enforced by trigger.';

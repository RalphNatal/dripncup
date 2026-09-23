-- ============================================================================
-- Catering requests.
--
-- Workflow: submitted -> quoted -> confirmed -> fulfilled, with cancelled
-- reachable from anywhere before fulfilment. The customer creates the request;
-- only an admin moves it forward.
-- ============================================================================

-- Catering references look like CAT-260923-004. Shares daily_counters with
-- order numbers; see 20260101000010_orders.sql.
--
-- Signed-in customers need EXECUTE because the column default runs as the
-- inserting role. They get today's number only: a custom `as_of` would let
-- anyone with an account fill daily_counters with a row per arbitrary date.
create or replace function public.next_catering_number(as_of timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A defaulted argument is exactly now() (the transaction timestamp), so
  -- this only rejects an explicit, different instant from an API caller.
  if as_of is distinct from now() and auth.role() in ('anon', 'authenticated') then
    raise exception 'Only the server may number catering requests for another date'
      using errcode = 'insufficient_privilege';
  end if;

  return 'CAT-'
    || to_char(public.cafe_date(as_of), 'YYMMDD')
    || '-'
    || lpad(public.next_daily_number('catering', as_of)::text, 3, '0');
end;
$$;

revoke execute on function public.next_catering_number(timestamptz) from public, anon;
grant execute on function public.next_catering_number(timestamptz) to authenticated, service_role;

create table public.catering_requests (
  id                  uuid primary key default gen_random_uuid(),
  -- Short human reference used in emails, e.g. CAT-260923-004.
  request_number      text not null unique default public.next_catering_number()
                      check (request_number <> ''),

  -- Null only after the customer deleted their account (see anonymized_at).
  user_id             uuid references public.profiles (id) on delete set null,

  -- Required while the request belongs to someone; cleared by account deletion.
  contact_name        text,
  contact_email       text,
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

  -- Set by account deletion when the contact details were scrubbed.
  anonymized_at       timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- A live request must say whose it is and how to reach them. Only an
  -- anonymised record (kept for catering revenue reports) may lack them.
  constraint catering_owner_and_contact_or_anonymized check (
    anonymized_at is not null
    or (user_id is not null and contact_name is not null and contact_email is not null)
  ),
  constraint catering_delivery_needs_address check (
    fulfillment <> 'delivery' or delivery_address is not null or anonymized_at is not null
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

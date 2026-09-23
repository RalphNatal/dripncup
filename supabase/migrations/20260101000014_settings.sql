-- ============================================================================
-- Key/value business settings, editable from /admin.
--
-- `is_public` decides whether anonymous visitors may read the row. Tax rate,
-- tip presets and lead times are public (the checkout screen needs them);
-- anything operational stays admin-only. Secrets never live here -- they are
-- environment variables.
-- ============================================================================

create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  is_public   boolean not null default false,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- Defaults. The seed script does not own these; they are part of the schema so
-- a fresh database is immediately usable.
insert into public.settings (key, value, description, is_public) values
  (
    'tax.get_rate',
    '0.04712'::jsonb,
    'Hawaii General Excise Tax rate applied to the post-discount subtotal. 0.04712 is the standard Oahu visible pass-on rate (4% state GET + 0.5% county surcharge, grossed up). CONFIRM WITH OWNER before launch.',
    true
  ),
  (
    'tip.presets',
    '[0, 15, 18, 20]'::jsonb,
    'Tip percentages offered at checkout. 0 renders as "No tip"; a custom amount is always available.',
    true
  ),
  (
    'tip.default_preset',
    '18'::jsonb,
    'Tip percentage preselected at checkout.',
    true
  ),
  (
    'catering.min_lead_time_hours',
    '72'::jsonb,
    'Minimum hours between submission and the catering event. Enforced in the date picker and by a database trigger.',
    true
  ),
  (
    'loyalty.points_per_dollar',
    '2'::jsonb,
    'Overflow Rewards points earned per USD spent, credited when an order is marked picked up.',
    true
  ),
  (
    'loyalty.program_name',
    '"Overflow Rewards"'::jsonb,
    'Display name of the loyalty programme.',
    true
  ),
  (
    'orders.scheduling_slot_minutes',
    '15'::jsonb,
    'Granularity of scheduled pickup slots.',
    true
  ),
  (
    'orders.max_scheduling_days_ahead',
    '7'::jsonb,
    'How far ahead a customer may schedule a pickup.',
    true
  ),
  (
    'orders.accepting_online_orders',
    'true'::jsonb,
    'Global kill switch for online ordering, independent of the per-location pause toggle.',
    true
  ),
  (
    'store.pickup_instructions',
    '"Head to the pickup shelf at the end of the counter -- your name will be on the cup."'::jsonb,
    'Default pickup copy, overridable per location. CONFIRM WORDING WITH OWNER.',
    true
  );

comment on table public.settings is
  'Admin-editable business settings. is_public rows are readable anonymously; secrets belong in env vars.';

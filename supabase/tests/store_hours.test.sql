-- ============================================================================
-- Opening hours are enforced in the app, never in SQL.
--
-- Open/closed, closures and holiday hours are decided by the pure TypeScript
-- rules in src/lib/locations/status.ts, fed through openingHours() in
-- src/lib/locations/opening-hours.ts. That one door is how local test mode
-- (TEST_STORE_ALWAYS_OPEN) reaches every check, behind a guard that can only
-- pass on a development build talking to a local database. A database
-- function that read location_hours or closures itself would quietly ignore
-- test mode, and there is no safe way to give it the flag: a setting row or
-- GUC could be flipped on the hosted database, where NODE_ENV and the
-- Supabase URL cannot be checked.
--
-- So: no function in the public schema may read those tables. If you need
-- hours in SQL one day, have the server pass the decision in as a parameter
-- (as the payment webhook does with mark_order_paid's p_reject_reason), and
-- update docs/SPEC.md's Decisions Log.
--
-- Run with `npm run test:db`.
-- ============================================================================
begin;

select plan(3);

select is(
  (
    select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc ~* '\mlocation_hours\M'
  ),
  '',
  'no public function reads location_hours'
);

select is(
  (
    select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc ~* '\mclosures\M'
  ),
  '',
  'no public function reads closures'
);

-- 24:00 is how the app writes "until midnight" (a 24-hour day, and the e2e
-- suite's always-open fixture); the table must accept it.
select lives_ok(
  $$
    insert into public.location_hours (location_id, day_of_week, opens_at, closes_at)
    select id, 3, '00:00', '24:00' from public.locations order by created_at limit 1
  $$,
  'location_hours accepts a midnight-to-midnight day'
);

select * from finish();
rollback;

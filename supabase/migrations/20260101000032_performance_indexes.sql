-- ============================================================================
-- Phase 10: index review.
--
-- Checked against pg_stat_statements and every page's queries (ARCHITECTURE.md,
-- "Performance"): the customer history (orders_user_created_idx), tracker
-- (primary key), rewards activity (loyalty_transactions_user_idx), favourites
-- (favorites_user_idx), staff queue (orders_location_status_idx), outboxes
-- (their partial "due" indexes) and reports (orders_location_placed_idx) are
-- covered. One lookup was not: a refund is found by its payment on every
-- refund, retry and charge.refunded webhook.
--
-- Foreign keys left unindexed on purpose: the created_by / updated_by /
-- confirmed_by style audit columns, only scanned when a profile is deleted
-- (rare, and those tables stay small at one cafe).
-- ============================================================================

create index if not exists refunds_payment_idx on public.refunds (payment_id);

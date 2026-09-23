-- ============================================================================
-- Row Level Security.
--
-- RLS is enabled on every table in `public`. The shape of the policy set:
--
--   catalog (menu, hours, collections, rewards)  -> world-readable when active,
--                                                   admin-writable
--   customer-owned rows (orders, favourites,
--     loyalty, catering)                         -> owner sees own, staff see
--                                                   their location, admin sees all
--   promos, payments, counters                   -> never client-readable;
--                                                   server code only
--
-- The service role bypasses RLS entirely, which is why it must never reach the
-- browser.
-- ============================================================================

alter table public.profiles                enable row level security;
alter table public.staff_locations         enable row level security;
alter table public.locations               enable row level security;
alter table public.location_hours          enable row level security;
alter table public.closures                enable row level security;
alter table public.categories              enable row level security;
alter table public.products                enable row level security;
alter table public.product_sizes           enable row level security;
alter table public.modifier_groups         enable row level security;
alter table public.modifier_options        enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.location_availability   enable row level security;
alter table public.event_menu_items        enable row level security;
alter table public.collections             enable row level security;
alter table public.collection_products     enable row level security;
alter table public.promos                  enable row level security;
alter table public.promo_redemptions       enable row level security;
alter table public.rewards                 enable row level security;
alter table public.orders                  enable row level security;
alter table public.order_items             enable row level security;
alter table public.order_status_history    enable row level security;
alter table public.payments                enable row level security;
alter table public.loyalty_transactions    enable row level security;
alter table public.favorites               enable row level security;
alter table public.catering_requests       enable row level security;
alter table public.catering_request_items  enable row level security;
alter table public.settings                enable row level security;
alter table public.daily_counters          enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Inserts come from the on_auth_user_created trigger (definer), not clients.
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- RLS picks the row; column privileges pick what may change on it. Without
-- this a customer could set their own loyalty_points or member_code.
-- loyalty_points is written by the definer ledger trigger, deleted_at by the
-- account-deletion flow (service role), and email mirrors auth.users.
-- `role` stays grantable because guard_profile_role_change() limits it to
-- admins.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (full_name, first_name, phone, marketing_opt_in, sms_opt_in, notification_prefs, role)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- staff_locations -- rosters. Staff may see their own assignment.
-- ---------------------------------------------------------------------------
create policy staff_locations_select on public.staff_locations
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

create policy staff_locations_admin_write on public.staff_locations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Catalog and storefront data: readable by anyone (guests browse the menu),
-- writable only by admins. Inactive rows stay visible to staff/admin so the
-- dashboards can manage them.
-- ---------------------------------------------------------------------------
create policy locations_public_read on public.locations
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy locations_admin_write on public.locations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy location_hours_public_read on public.location_hours
  for select to anon, authenticated using (true);

create policy location_hours_admin_write on public.location_hours
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy closures_public_read on public.closures
  for select to anon, authenticated using (true);

create policy closures_admin_write on public.closures
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy categories_admin_write on public.categories
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy products_public_read on public.products
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy products_admin_write on public.products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy product_sizes_public_read on public.product_sizes
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy product_sizes_admin_write on public.product_sizes
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy modifier_groups_public_read on public.modifier_groups
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy modifier_groups_admin_write on public.modifier_groups
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy modifier_options_public_read on public.modifier_options
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy modifier_options_admin_write on public.modifier_options
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy product_modifier_groups_public_read on public.product_modifier_groups
  for select to anon, authenticated using (true);

create policy product_modifier_groups_admin_write on public.product_modifier_groups
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy event_menu_items_public_read on public.event_menu_items
  for select to anon, authenticated using (true);

create policy event_menu_items_admin_write on public.event_menu_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy collections_public_read on public.collections
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy collections_admin_write on public.collections
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy collection_products_public_read on public.collection_products
  for select to anon, authenticated using (true);

create policy collection_products_admin_write on public.collection_products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy rewards_public_read on public.rewards
  for select to anon, authenticated
  using (is_active or public.is_staff());

create policy rewards_admin_write on public.rewards
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- location_availability -- the sold-out board. Everyone reads it (the menu
-- needs it); baristas write it, but only for their own counter.
-- ---------------------------------------------------------------------------
create policy location_availability_public_read on public.location_availability
  for select to anon, authenticated using (true);

create policy location_availability_staff_write on public.location_availability
  for all to authenticated
  using (public.can_access_location(location_id))
  with check (public.can_access_location(location_id));

-- ---------------------------------------------------------------------------
-- promos -- intentionally opaque to customers. Exposing this table would let
-- anyone enumerate every live discount code.
-- ---------------------------------------------------------------------------
create policy promos_admin_only on public.promos
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy promo_redemptions_select on public.promo_redemptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy promo_redemptions_admin_write on public.promo_redemptions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create policy orders_select_own_or_staff on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.can_access_location(location_id));

-- No INSERT policy: orders are created only by the checkout route with the
-- service role, after it has priced the cart. A client insert could set
-- status = 'placed' directly -- the transition trigger only guards UPDATE --
-- and skip payment entirely.

-- Customers never move their own order along; only the counter does.
create policy orders_update_staff on public.orders
  for update to authenticated
  using (public.can_access_location(location_id))
  with check (public.can_access_location(location_id));

-- ---------------------------------------------------------------------------
-- order_items -- reachable only through the parent order. Updates and deletes
-- have no policy at all, which combined with the freeze trigger makes the
-- snapshot genuinely immutable.
-- ---------------------------------------------------------------------------
create policy order_items_select on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (o.user_id = auth.uid() or public.can_access_location(o.location_id))
    )
  );

-- Likewise no INSERT policy: the checkout route writes the snapshot lines
-- with the service role alongside the order itself.

create policy order_status_history_select on public.order_status_history
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_status_history.order_id
        and (o.user_id = auth.uid() or public.can_access_location(o.location_id))
    )
  );

-- ---------------------------------------------------------------------------
-- payments -- readable for receipts, never client-writable. The Stripe webhook
-- writes with the service role.
-- ---------------------------------------------------------------------------
create policy payments_select on public.payments
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (o.user_id = auth.uid() or public.is_admin())
    )
  );

-- ---------------------------------------------------------------------------
-- loyalty
-- ---------------------------------------------------------------------------
create policy loyalty_transactions_select_own on public.loyalty_transactions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy loyalty_transactions_admin_write on public.loyalty_transactions
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- favorites -- entirely private to their owner.
-- ---------------------------------------------------------------------------
create policy favorites_own on public.favorites
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- catering
-- ---------------------------------------------------------------------------
create policy catering_requests_select on public.catering_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy catering_requests_insert_own on public.catering_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'submitted');

-- Quoting, confirming and cancelling are admin actions.
create policy catering_requests_admin_write on public.catering_requests
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy catering_request_items_select on public.catering_request_items
  for select to authenticated
  using (
    exists (
      select 1 from public.catering_requests c
      where c.id = catering_request_items.catering_request_id
        and (c.user_id = auth.uid() or public.is_admin())
    )
  );

create policy catering_request_items_insert on public.catering_request_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.catering_requests c
      where c.id = catering_request_items.catering_request_id
        and c.user_id = auth.uid()
        and c.status = 'submitted'
    )
  );

create policy catering_request_items_admin_write on public.catering_request_items
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- settings -- public keys power the checkout screen; the rest is admin-only.
-- ---------------------------------------------------------------------------
create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (is_public or public.is_admin());

create policy settings_admin_write on public.settings
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- daily_counters -- no policies at all. Only the SECURITY DEFINER numbering
-- functions and the service role may touch it.
-- ---------------------------------------------------------------------------

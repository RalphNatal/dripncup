-- ============================================================================
-- Drincup Cafe — extensions and shared enum types
-- ============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- Who the account belongs to. Drives every RLS policy in the schema.
create type public.user_role as enum ('customer', 'staff', 'admin');

-- The permanent cafe vs. a time-boxed pop-up booth.
create type public.location_type as enum ('cafe', 'event');

-- Order lifecycle. `pending_payment` exists only between "customer pressed pay"
-- and "Stripe webhook confirmed"; nothing reaches the barista queue until
-- `placed`. Transitions are enforced by a trigger (see order_logic migration).
create type public.order_status as enum (
  'pending_payment',
  'placed',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'cancelled',
  'refunded'
);

create type public.fulfillment_type as enum ('pickup', 'delivery');

-- ASAP uses the location's prep time; scheduled pins a 15-minute slot.
create type public.pickup_type as enum ('asap', 'scheduled');

create type public.payment_status as enum (
  'requires_payment',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded'
);

create type public.catering_status as enum (
  'submitted',
  'quoted',
  'confirmed',
  'fulfilled',
  'cancelled'
);

create type public.promo_type as enum ('percent', 'fixed');

create type public.reward_type as enum ('free_item', 'free_addon', 'percent_off', 'amount_off');

-- Single-select renders as radios, multi as checkboxes/steppers.
create type public.modifier_selection_type as enum ('single', 'multi');

create type public.loyalty_transaction_type as enum ('earn', 'redeem', 'adjust', 'reverse');

-- Declared allergens. Macadamia is called out separately from tree nuts
-- because it is the one Hawaii customers ask about most.
create type public.allergen as enum (
  'dairy',
  'tree_nuts',
  'macadamia',
  'peanuts',
  'gluten',
  'soy',
  'egg',
  'sesame'
);

create type public.dietary_tag as enum (
  'vegan',
  'vegetarian',
  'dairy_free',
  'gluten_free',
  'nut_free',
  'contains_caffeine',
  'decaf'
);

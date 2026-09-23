# Architecture

How Drincup Cafe's order-ahead app is put together: the data model, the order
lifecycle, the catering workflow, and where pricing is decided.

---

## Guiding rules

Four rules explain most of the design decisions below.

1. **The server owns every number.** Prices, discounts, tax and totals are
   recalculated from the database on every checkout. A client-sent amount is
   treated as a hint for rendering, never as truth.
2. **Money is integer cents.** Floats are never used. A float subtotal produces
   one-cent discrepancies that compound through GET and tip calculations.
3. **Hawaii time, always.** `Pacific/Honolulu` is UTC−10 with no daylight
   saving. Vercel runs in UTC, so no code may rely on the ambient timezone.
4. **Past orders are immutable.** `order_items` stores a snapshot of the
   product, size, modifiers and price. Renaming a drink or raising a price
   tomorrow must not rewrite a receipt from last week.

---

## Data model

28 tables in `public`. Grouped by what they are for:

### People and places

| Table | Purpose |
| ----- | ------- |
| `profiles` | One row per `auth.users` row. Carries `role`, loyalty balance, member code, notification preferences. |
| `staff_locations` | Which baristas see which queues. Admins bypass it. |
| `locations` | The Kapiolani cafe (`type = 'cafe'`) and pop-up booths (`type = 'event'`, with `starts_at`/`ends_at`). |
| `location_hours` | Weekly opening hours. Multiple rows per day allow split service. |
| `closures` | One-off closures and holiday-hour overrides. A null `location_id` applies everywhere. |

### The menu

| Table | Purpose |
| ----- | ------- |
| `categories` | Coffee & Espresso, Tropical Refreshers, Shave Ice, … |
| `products` | Name, description, allergens, dietary tags, catering eligibility. |
| `product_sizes` | Each size carries its own **absolute** price, not a delta — a large cold brew is not reliably "small plus a fixed amount". |
| `modifier_groups` | Reusable customisation groups: Milk, Syrups, Sweetness, Ice. |
| `modifier_options` | The choices inside a group, each with a `price_delta_cents`. |
| `product_modifier_groups` | Links products to groups, with optional per-product overrides of required/min/max. |
| `location_availability` | Sold-out overrides. **A row exists only when something is unavailable** — no row means available. |
| `event_menu_items` | The subset of the catalog a pop-up booth carries. |
| `collections` / `collection_products` | Seasonal ranges, shown and hidden purely by date window. |

The customisation sheet is entirely data-driven. `selection_type`
(single/multi), `is_required`, `min_selections`, `max_selections` and
`max_quantity_per_option` between them describe radios, checkboxes, and
steppers for pump counts and extra shots. **No modifier is hardcoded in UI
code.**

### Orders

| Table | Purpose |
| ----- | ------- |
| `orders` | One per checkout. Holds the full money breakdown plus the tax rate in force at the time. |
| `order_items` | Immutable snapshot lines. `modifiers` is JSONB. |
| `order_status_history` | Append-only audit, written by a trigger on every status change. |
| `payments` | Provider-agnostic. Only Stripe identifiers and status — card data never reaches us. |

### Money and loyalty

| Table | Purpose |
| ----- | ------- |
| `promos` / `promo_redemptions` | Codes and their usage. `unique (promo_id, order_id)` stops a retried checkout double-counting a limited code. |
| `rewards` | Overflow Rewards tiers. |
| `loyalty_transactions` | Append-only points ledger. `profiles.loyalty_points` is a cached sum kept in step by trigger. |
| `favorites` | "My usual" — a named, fully customised drink. |

### Catering and configuration

| Table | Purpose |
| ----- | ------- |
| `catering_requests` / `catering_request_items` | Enquiries and their line items. |
| `settings` | Admin-editable key/value config. `is_public` decides anonymous readability. |
| `daily_counters` | Backs the human-readable `DC-260923-0042` order numbers. Not client-readable. |

---

## Security model

RLS is enabled on **every** table. Three shapes:

**World-readable, admin-writable** — the storefront. Guests browse without an
account, so `locations`, `categories`, `products`, `product_sizes`,
`modifier_groups`, `modifier_options`, `collections`, `rewards`,
`location_hours` and `closures` are readable by `anon`. Inactive rows stay
visible to staff and admins so the dashboards can manage them.

**Owner-scoped** — `orders`, `order_items`, `favorites`,
`loyalty_transactions`, `catering_requests`. A customer sees their own rows;
staff additionally see orders for locations they are rostered to, via
`can_access_location()`; admins see everything. Customers can read their
orders but never insert them: the checkout route creates `orders` and
`order_items` with the service role after pricing the cart, because a client
insert could set `status = 'placed'` and skip payment.

**Server-only** — `promos`, `payments` and `daily_counters` have no customer
read policy at all. Exposing `promos` would let anyone enumerate every live
discount code, so a customer types a code and the server validates it with the
service role.

Permission checks run through four `SECURITY DEFINER` helpers — `auth_role()`,
`is_admin()`, `is_staff()`, `can_access_location()` — so policies never query
`profiles` inline, which would recurse against that table's own policy.

Three guardrails sit alongside the policies:

- `guard_profile_role_change()` rejects a non-admin changing `profiles.role`.
  Without it, a customer who can edit their own profile could promote
  themselves to admin.
- Column privileges on `profiles`: `authenticated` may update only
  `full_name`, `first_name`, `phone`, the opt-ins, `notification_prefs` and
  `role` (the last still subject to the guard above). RLS picks the row;
  without the column grant a customer could set their own `loyalty_points` or
  `member_code`. The ledger trigger writes points as the table owner.
- Staff are deliberately **not** granted `UPDATE` on `locations`. The pause
  toggle goes through `set_location_accepting_orders()`, a definer RPC that
  exposes exactly that one column, so a barista cannot edit addresses or prep
  times.

`/staff` and `/admin` are also gated in `src/proxy.ts` before any page code
runs. That check reads the database rather than a JWT claim, so a role change
takes effect immediately instead of whenever the access token next rotates.

The service role key bypasses RLS entirely. It is confined to
`src/lib/supabase/admin.ts`, which imports `server-only` — an accidental client
import becomes a build error rather than a leaked key.

### Authentication

Email and password through Supabase Auth, with the session in cookies via
`@supabase/ssr`.

- **Forms** post to Server Actions in `src/lib/auth/actions.ts` and
  `src/app/account/actions.ts`, validated by the Zod schemas in
  `src/lib/auth/schemas.ts`. They are plain `<form>` posts, so they work
  before JavaScript loads.
- **Sign-up** passes `full_name`, `phone` and `marketing_opt_in` as user
  metadata; `handle_new_user()` copies them into `profiles`. Metadata is
  client-controlled, so the trigger never reads `role` from it and treats the
  opt-in as true only when it is literally `true`.
- **Emailed links** (confirmation, password reset) land on
  `/auth/callback`, which exchanges the PKCE code for a session and continues
  to `next`. A reset continues to `/account/password`.
- **`?next=` is sanitised** by `safeNextPath()`: only same-origin paths get
  through, so a crafted sign-in link cannot bounce someone to a lookalike site.
- **Authorization runs twice.** The proxy is the fast, optimistic gate. Pages
  and actions check again through `requireProfile()` / `requireRole()` in
  `src/lib/auth/dal.ts`, because Server Actions and nested segments can be
  reached without passing through the proxy-gated page. The route table lives
  in `src/lib/auth/roles.ts` and both layers read it.
- **Password reset never reveals** whether an address has an account; the
  reply is the same either way.

---

## Order lifecycle

```
                    ┌──────────────┐
                    │pending_payment│  created at checkout, invisible to staff
                    └───────┬──────┘
          Stripe webhook    │
          confirms payment  ▼
                    ┌──────────────┐
                    │    placed    │  enters the barista queue
                    └───────┬──────┘
                            ▼
                    ┌──────────────┐
                    │   accepted   │
                    └───────┬──────┘
                            ▼
                    ┌──────────────┐
                    │  preparing   │
                    └───────┬──────┘
                            ▼
                    ┌──────────────┐
                    │    ready     │  customer alerted, in-app + sound
                    └───────┬──────┘
                            ▼
                    ┌──────────────┐
                    │  picked_up   │  loyalty points credited here
                    └───────┬──────┘
                            ▼
                    ┌──────────────┐
                    │   refunded   │
                    └──────────────┘

cancelled is reachable from any state before picked_up, and requires a reason.
refunded is reachable from picked_up or cancelled, and is terminal.
```

Enforcement is layered:

- `is_valid_order_transition(from, to)` in SQL is the **enforcing** copy. A
  `BEFORE UPDATE` trigger rejects anything else and stamps the matching
  timestamp column, so an order cannot skip from Placed straight to Picked Up
  regardless of which codepath tried.
- `ORDER_TRANSITIONS` in `src/lib/order-status.ts` mirrors it so the UI can grey
  out impossible buttons without a round trip. A unit test parses the migration
  and asserts the two are identical — they cannot drift silently.
- `record_order_status_change()` writes `order_status_history` automatically.
- `freeze_order_items()` blocks updates and deletes to `order_items` once the
  parent order has left `pending_payment`.

**Idempotency.** Order creation takes a client-supplied `idempotency_key` with
a unique constraint. A double-tapped pay button reuses the key and returns the
existing order instead of creating a second one.

**Order numbers.** `DC-` + the HST date + a per-day sequence, e.g.
`DC-260923-0042`. Generated by the column default `next_order_number()`, which
does an `INSERT … ON CONFLICT DO UPDATE … RETURNING` against `daily_counters`
and is atomic under concurrent checkouts. The date and the counter's reset both
use `cafe_today()`, the Pacific/Honolulu date, so an 11 PM HST order still gets
that day's number even though it is already tomorrow in UTC. A default rather
than a trigger keeps the column optional in the generated `Insert` types.

**Realtime.** `orders`, `order_status_history` and `location_availability` are
in the `supabase_realtime` publication, and `orders` is set to
`REPLICA IDENTITY FULL` so the payload carries the previous row — that is how
the client distinguishes "status changed" from any other update. RLS applies to
realtime payloads, so a customer only receives changes to orders they may
select.

---

## Pricing

All of it lands in one pure function, `calculateOrderTotal` (Phase 4), with unit
tests covering modifiers, promos, rewards, tax and tips.

```
  line unit price  = size price (or product base price)
                     + Σ (modifier delta × modifier quantity)
  line total       = unit price × quantity

  subtotal         = Σ line totals
  discount         = promo + reward, capped at the subtotal
  taxable base     = subtotal − discount
  tax (GET)        = round(taxable base × tax_rate)
  tip              = round(subtotal × tip_percent)   ← pre-tax, post-discount
  total            = taxable base + tax + tip
```

Three decisions worth stating explicitly:

- **GET applies after discounts**, to the post-discount subtotal.
- **Tips are excluded from the taxed amount** and reported separately.
  *(NEEDS_CONFIRMATION with the owner.)*
- **Tip is calculated on the pre-tax, post-discount subtotal**, which is what
  customers expect and keeps the tip stable if the tax rate changes.

Rounding uses `roundCents()`, which rounds **half away from zero** — what a
till does. `Math.round()` rounds half *up*, so `-0.5` becomes `-0`; that
asymmetry would quietly favour one side on refunds and negative modifier
deltas.

`orders.tax_rate` stores the rate in force at the time of the order, so editing
the GET setting in admin never rewrites old receipts.

### What checkout re-validates

Menu-page state is not trusted at checkout. Before payment the server
re-verifies: the location is open and not paused, an event is inside its
window, every product and modifier option is still available at that location,
the promo is valid for this user and spend, the reward is affordable, and the
scheduled slot is still within opening hours.

---

## Catering workflow

```
  submitted ──► quoted ──► confirmed ──► fulfilled
      │           │            │
      └───────────┴────────────┴──► cancelled
```

- The customer submits. A `BEFORE INSERT` trigger rejects anything inside the
  configured minimum lead time (`settings.catering.min_lead_time_hours`,
  seeded at 72), so the rule holds even if the date picker is bypassed.
- An admin sets `quote_amount_cents` and attaches a Stripe payment link →
  **quoted**.
- Payment confirms → **confirmed**. Event day → **fulfilled**.
- A trigger enforces the transitions and stamps the timestamps, the same way
  orders work.
- Each step sends the customer an email (Phase 8).

Request numbers follow the order-number pattern: `CAT-260923-004`.

---

## Loyalty

`loyalty_transactions` is an append-only signed ledger; `profiles.loyalty_points`
is a cached sum maintained by an `AFTER INSERT OR DELETE` trigger. The ledger is
always the truth.

| Type | Sign | When |
| ---- | ---- | ---- |
| `earn` | + | Order marked **picked_up** — not at payment |
| `redeem` | − | Points spent on a reward |
| `reverse` | − | Clawback after a cancellation or refund |
| `adjust` | ± | Manual admin correction |

A partial unique index allows only one `earn` row per order, so a replayed
Stripe webhook cannot double-credit.

---

## Time handling

`src/lib/time.ts` is the only place instants convert to Hawaii wall time.
Instants are stored and passed as UTC `timestamptz`; `location_hours` stores
wall-clock `time` values, and `cafeDateAtTime()` combines a calendar day with
one to produce a comparable instant.

Because Hawaii has no daylight saving there are no spring-forward gaps or
repeated hours to special-case — a simplification the rest of the scheduling
logic leans on.

Postgres has matching helpers: `cafe_today()` and `cafe_clock()`.

---

## Deliberately deferred

Third-party delivery, native apps, gift cards, POS integration and
multi-language support are out of scope for v1. The seams that keep them
possible:

- `payments` is provider-agnostic (`provider` + opaque `provider_*_id`), so
  swapping Stripe for Square is a data change, not a schema change.
- `orders.fulfillment` already models `delivery` alongside `pickup`.
- All user-facing copy is centralised in `src/lib/brand.ts` rather than
  scattered through components.

Not yet built, with a phase to be agreed:

- **Self-service account deletion.** `profiles.deleted_at` exists and signed-in
  checks already treat a deleted profile as signed out, but the flow that
  scrubs personal fields and removes the auth user is not written.
- **Changing email address.** `profiles.email` is copied at sign-up; an email
  change through Supabase Auth would need a trigger on `auth.users` to keep it
  in step.
- **Social sign-in** (Google, Apple). No provider is configured.

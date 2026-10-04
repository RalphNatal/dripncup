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

33 tables in `public`. Grouped by what they are for:

### People and places

| Table | Purpose |
| ----- | ------- |
| `profiles` | One row per `auth.users` row. Carries `role`, loyalty balance, member code, notification preferences. |
| `staff_locations` | Which baristas see which queues. Admins bypass it. |
| `locations` | The Kapiolani cafe (`type = 'cafe'`) and pop-up booths (`type = 'event'`, with `starts_at`/`ends_at`). The staff pause toggle is `accepting_orders`, with `paused_until` (automatic resume), `paused_at` and `paused_by`. |
| `location_hours` | Weekly opening hours. Multiple rows per day allow split service. |
| `closures` | One-off closures and holiday-hour overrides. A null `location_id` applies everywhere. |

### The menu

| Table | Purpose |
| ----- | ------- |
| `categories` | Coffee & Espresso, Tropical Refreshers, Shave Ice, … |
| `products` | Name, description, allergens, dietary tags, catering eligibility. |
| `product_sizes` | Each size carries its own **absolute** price, not a delta — a large cold brew is not reliably "small plus a fixed amount". |
| `modifier_groups` | Reusable customisation groups: Milk, Syrups, Sweetness, Ice. `quantity_unit` names one unit ("pump", "shot"); `charge_per_quantity` says whether a delta is charged per unit (extra shots) or once (a flavour at any number of pumps). |
| `modifier_options` | The choices inside a group, each with a `price_delta_cents`. |
| `product_modifier_groups` | Links products to groups, with optional per-product overrides of required/min/max, and `visible_when_option_id` for conditional groups. |
| `location_availability` | Sold-out overrides. **A row exists only when something is unavailable** — no row means available. `available_from` is the automatic reset ("until end of day"); null means until someone turns it back on. Written only through `set_sold_out()`. |
| `location_availability_log` | Append-only: who marked what sold out or back on, where and when (trigger on `location_availability`). Readable by staff of that location. |
| `event_menu_items` | The subset of the catalog a pop-up booth carries. |
| `collections` / `collection_products` | Seasonal ranges, shown and hidden purely by date window. |

The customisation sheet is entirely data-driven. **No modifier is hardcoded in
UI code.** How data becomes controls:

| Data | Renders as |
| ---- | ---------- |
| `selection_type = 'single'` | Radio buttons |
| `'multi'`, option max quantity 1 | Checkboxes |
| `'multi'`, option max quantity > 1 | Checkbox, then a +/- stepper labelled with `quantity_unit` ("2 pumps") |
| `'multi'` with a single option that allows > 1 | A bare +/- stepper from 0 (extra shots) |
| `is_default` options | Preselected, unless sold out at the location, in which case the customer chooses |
| `is_required`, `min_selections`, `max_selections` | Inline "Required · up to 3" hints and messages; further checkboxes lock once the maximum is reached |
| `visible_when_option_id` | The group appears only while that option is chosen, e.g. Ice once Iced is picked |

**Conditional groups** hang off the product link, not the group, because the
same Ice group is conditional on a hot-or-iced latte but always shown on a
lemonade. A deferred constraint trigger requires the controlling option to
come from another group on the same product. A hidden group is not validated,
not charged and not stored on the cart line. Its defaults stay filled in, so
switching to Iced shows Ice with "Regular ice" already chosen. If the
controlling option is deleted, the FK sets the column to null and the group
is always shown: showing an unneeded choice is safer than hiding a needed one.

### Orders

| Table | Purpose |
| ----- | ------- |
| `orders` | One per checkout. Holds the full money breakdown plus the tax rate in force at the time. `user_id` is null only after an account deletion (`anonymized_at` set). |
| `order_items` | Immutable snapshot lines. `modifiers` is JSONB. |
| `order_status_history` | Append-only audit, written by a trigger on every status change. |
| `payments` | Provider-agnostic. Only Stripe identifiers and status — card data never reaches us. Never stores a client secret. Records the last failure (`failure_code`, `failure_message`), the running `refunded_cents`, and for the receipt the card brand, last four and wallet (`method_*`, copied from the charge by the webhook). |
| `refunds` | One row per refund attempt, written **before** the provider is called, so a crash or a decline still leaves a record. `failed` rows are the admin retry queue. Customers can read refunds on their own orders. |
| `webhook_events` | One row per provider event id: the dedupe log. Service role only. |
| `rate_limit_hits` | Fixed-window counters for checkout and promo-code limits. Service role only. |
| `email_outbox` | Customer emails owed by order status changes, written by trigger in the same transaction and delivered by the server-side sender. Unique `dedupe_key` (kind + order). Admins can read it; only the server writes. |

### Money and loyalty

| Table | Purpose |
| ----- | ------- |
| `promos` / `promo_redemptions` | Codes and their usage. `unique (promo_id, order_id)` stops a retried checkout double-counting a limited code. |
| `rewards` | Overflow Rewards tiers: `free_item` / `free_modifier` / `amount_off`, points cost, eligibility (products, categories, add-on groups), value cap, active and sort order. |
| `loyalty_transactions` | Append-only points ledger. `profiles.loyalty_points` is a cached sum kept in step by trigger, and may be negative. |
| `loyalty_reservations` | Points a checkout holds: held → redeemed (paid) or released. One per order. |
| `order_rewards` | Snapshot of the rewards an order used: name, cost, discount, line, free add-on. |
| `favorites` | "My usual" — a named, fully customised drink, stored as the same modifier snapshot an order line keeps. Names 1–40 characters, unique per customer ignoring case; at most 50 per customer (trigger, `DC003`). Private to the owner (RLS). |

### Catering and configuration

| Table | Purpose |
| ----- | ------- |
| `catering_requests` / `catering_request_items` | Enquiries and their line items. `location_id` is the counter that prepares it (defaults to the cafe). Contact fields and `user_id` are cleared by account deletion (`anonymized_at` set). |
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
`profiles` inline, which would recurse against that table's own policy. A
deleted profile has no role, and a `staff_locations` row counts only while
the profile is still `staff`: demoting a barista to customer ends their access
to the counter at once, even if the roster row is left behind.

Guardrails alongside the policies:

- `guard_profile_role_change()` rejects a non-admin changing `profiles.role`.
  Without it, a customer who can edit their own profile could promote
  themselves to admin.
- Column privileges on `profiles`: `authenticated` may update only
  `full_name`, `first_name`, `phone`, the opt-ins, `notification_prefs` and
  `role` (the last still subject to the guard above). RLS picks the row;
  without the column grant a customer could set their own `loyalty_points` or
  `member_code`. The ledger trigger writes points as the table owner.
- Staff are deliberately **not** granted `UPDATE` on `locations`. The pause
  toggle goes through `set_location_accepting_orders(location, accepting,
  resume_at?)`, a definer RPC that exposes exactly the pause columns, so a
  barista cannot edit addresses or prep times.
- **Sold out is changed only through `set_sold_out()`.** Clients have no
  write privilege on `location_availability`; the function checks the caller
  works that counter, and a trigger logs every change with its actor in
  `location_availability_log`.
- **Staff-only views are functions, not table grants.** The catering prep
  list (`staff_catering_prep`) and a ticket's history with names and its
  refundable amount (`staff_order_activity`) hand out just those fields for
  the caller's own counters; staff still cannot read `catering_requests`,
  `profiles` or `payments`.
- `get_setting()` reads any setting (it is how triggers read admin-only
  keys), so clients cannot call it. Staff read the `staff.*` settings through
  the `settings` policy.
- **Nobody but the service role writes orders.** `anon` and `authenticated`
  have no INSERT, UPDATE or DELETE privilege on `orders`, `order_items`,
  `order_status_history`, `payments` or `refunds` (revoked, not just
  missing a policy, so a future permissive policy cannot reopen it). Staff
  move an order along with `advance_order_status(order_id, new_status,
  reason?)`, a definer function that checks the caller is an admin or
  rostered to the order's location, allows only Accepted → Preparing → Ready
  → Picked Up and Cancelled, enforces the transition table, and writes the
  status, its timestamp and a cancel reason and nothing else. It refuses to
  cancel an order that holds money (`DC002`): that goes through
  `cancelOrderWithRefund()` on the server, which cancels with the
  service-role `cancel_order_for_refund()` and then refunds. Both record
  the staff member in `order_status_history.changed_by`.

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
  `src/app/(shop)/account/actions.ts`, validated by the Zod schemas in
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

### Account deletion

"Delete my account" on `/account` opens `/account/delete`, which explains what
happens and asks for the password plus the word `DELETE`. The `deleteAccount`
action then:

1. **Re-checks the password** with `verifyPassword()`
   (`src/lib/auth/reauthenticate.ts`). A throwaway, non-persisting Supabase
   client signs in, so the check never touches the visitor's session cookies,
   and the session it creates is revoked straight away. A stolen session
   cookie alone therefore cannot delete an account. The last admin is
   refused here too, before anything irreversible happens.
2. **Settles money first** (`settleOrdersBeforeAccountDeletion`,
   `src/lib/orders/account-deletion.ts`). Every paid order still in progress
   (`placed` to `ready`) is refunded in full; every checkout still waiting for
   payment has its PaymentIntent cancelled, so it cannot be charged after the
   account is gone. A refund the provider refuses does **not** block the
   deletion: it stays in `refunds` as `failed` for an admin to retry.
3. **Calls `delete_account_data()`** with the service role. In one
   transaction, it:
   - cancels unfinished orders (`pending_payment` through `ready`) and open
     catering requests, through the normal transition triggers, so the audit
     trail records it
   - keeps every order, payment and catering record for sales and tax
     reports, but clears the cup name, email, phone, notes, delivery address
     and stored Stripe payload, detaches `user_id` and stamps `anonymized_at`
   - detaches promo redemptions, and deletes favourites, the loyalty ledger
     and any staff roster rows
   - scrubs the profile and stamps `deleted_at`. From here on every
     signed-in check treats the account as closed.

   The function is `service_role`-only. The last remaining admin is refused
   (SQLSTATE `DC001`), under an advisory lock, so two admins cannot each
   delete themselves at once and leave the cafe without one.
4. **Signs this browser out, then deletes the auth user** through the admin
   API. That ends every other session, and `profiles` cascades away from
   `auth.users`. If this last call fails, the tombstone keeps the account
   locked out, and the next sign-in attempt with the right password finishes
   the deletion.
5. **Redirects to `/?account=deleted`**, and Home confirms it.

`order_items` are left as they are. They are the immutable snapshot of what
was sold (`freeze_order_items`) and carry no contact details.

Two constraints keep the flow honest. `orders_owner_or_anonymized` means an
order can only lose its owner through this flow, so a checkout bug cannot
write orphaned orders. It also means an auth user who has orders cannot be
deleted from the Supabase dashboard around the anonymising step; the FK's
`SET NULL` fails instead. `catering_owner_and_contact_or_anonymized` does the
same for catering, and the customer insert policy forbids setting
`anonymized_at`.

A payment that lands *after* the deletion (the customer paid in another tab a
moment before) finds its order cancelled; the webhook refunds it (see
"Checkout and payments").

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
- `record_order_status_change()` writes `order_status_history` automatically,
  with the actor: `auth.uid()`, or the staff member a service-role function
  names in the transaction-local `app.order_status_actor` setting, or null
  for the webhook and expiry job (the system).
- `freeze_order_items()` blocks updates and deletes to `order_items` once the
  parent order has left `pending_payment`.

**Idempotency.** Order creation takes a client-supplied `idempotency_key` with
a unique constraint. A double-tapped pay button reuses the key and returns the
existing order instead of creating a second one.

**Order numbers.** `DC-` + the HST date + a per-day sequence, e.g.
`DC-260923-0042`. Generated by the column default `next_order_number()`, which
does an `INSERT … ON CONFLICT DO UPDATE … RETURNING` against `daily_counters`
and is atomic under concurrent checkouts. The date and the counter's reset both
use `cafe_date()`, the Pacific/Honolulu date, so an 11 PM HST order still gets
that day's number even though it is already tomorrow in UTC. A default rather
than a trigger keeps the column optional in the generated `Insert` types.

The numbering functions take an optional `as_of timestamptz` (default `now()`)
so the rollover can be pinned by a test: `supabase/tests/numbering.test.sql`
checks 11:30 PM and 12:30 AM HST. Access is unchanged. `next_order_number` is
service-role only, and signed-in customers keep `next_catering_number` because
the catering column default runs as them. They can only take *today's* number,
though: an explicit `as_of` from `anon` or `authenticated` is refused, so an
account cannot fill `daily_counters` with a row for every date.

**Realtime.** `orders`, `order_status_history` and `location_availability` are
in the `supabase_realtime` publication, and `orders` has `REPLICA IDENTITY
FULL`. RLS applies to Realtime: for every subscription, Realtime re-reads the
changed row by primary key *as that subscriber* (`realtime.apply_rls`), so a
customer only receives changes to orders they may select. See "Order
tracking" below for how the app uses it.

---

## Pricing

All of it lands in one pure function, `calculateOrderTotal`
(`src/lib/pricing/order-total.ts`), with unit tests covering modifiers, promos,
rewards, tax, tips and rounding. The checkout page's quote and the order
`createCheckout` writes both come from it, so what the customer is shown is
what they are charged.

```
  line unit price  = size price (or product base price)
                     + Σ modifier delta × (quantity if the group charges
                                           per unit, else 1)
                     never below 0
  line total       = unit price × quantity             (quantity 1–99)

  subtotal         = Σ line totals
  promo            = evaluatePromo(...)                 capped at the subtotal
  reward           = applyRewards(...)                  capped at what is left (see Overflow Rewards)
  taxable base     = subtotal − promo − reward
  tax (GET)        = round(taxable base × tax_rate)     rounded once, per order
  tip              = preset % of the taxable base, or a custom amount
                     (custom: $0 up to min($100, 100% of subtotal), from settings)
  total            = taxable base + tax + tip
```

Three decisions worth stating explicitly:

- **GET applies after discounts**, to the post-discount subtotal.
- **Tips are excluded from the taxed amount** and reported separately.
  *(NEEDS_CONFIRMATION with the owner.)*
- **Tip is calculated on the pre-tax, post-discount subtotal**, which is what
  customers expect and keeps the tip stable if the tax rate changes.

**Rounding.** Everything is integer cents, and the engine never multiplies
money by a float. `src/lib/pricing/rounding.ts`:

- A tax rate becomes an integer number of hundred-thousandths
  (`0.04712` → `4712`), a percentage an integer number of hundredths
  (`18` → `1800`, `12.5` → `1250`).
- `divideRounded(numerator, denominator)` does the one division, rounding
  **half away from zero**, which is what a till does.
- So GET is `divideRounded(taxable × 4712, 100000)`: $12.35 at 4.712% is
  58.1932¢ → **58¢**; an exact half cent (e.g. 50¢ at 1%) rounds up to 1¢.
- Tax is rounded **once, on the order**, never per line: per-line rounding
  can drift a cent from what the GET return expects.
- A percentage promo or tip is rounded the same way, then capped.

`roundCents()` in `src/lib/money.ts` follows the same half-away-from-zero rule
for the few places outside the engine that round. `Math.round()` rounds half
*up*, so `-0.5` becomes `-0`; that asymmetry would quietly favour one side on
refunds and negative modifier deltas.

`orders.tax_rate` stores the rate in force at the time of the order, so editing
the GET setting in admin never rewrites old receipts.

### The shared engine (`src/lib/pricing/`)

The product sheet (browser) and checkout (server) run the same functions.
The folder may import only from itself; a test enforces that, so no React,
Next.js or Supabase code can creep in.

| Function | Job |
| -------- | --- |
| `defaultSelection(product, groups)` | Default size and every default option that is not sold out |
| `visibleGroupIds(groups, modifiers)` | Which conditional groups are showing |
| `validateSelection(product, groups, selection)` | Every reason the line cannot be made: sold out, missing size, required group empty, too few or too many, pump or shot limits, unknown ids, instructions over 100 characters |
| `resolveSelection(groups, modifiers)` | Ids → catalogue-priced `SelectedModifier`s for the showing groups. This is exactly the `order_items.modifiers` snapshot shape |
| `calculateLinePrice(product, size, resolved, quantity)` | Cents for the line |
| `pruneSelection`, `describeSelection`, `selectionKey` | Cart storage, human-readable summary, merging identical lines |

`calculateLinePrice` takes the *resolved* selection rather than raw ids, so a
price can only come from the catalogue: the client sends ids and quantities,
never amounts. `calculateOrderTotal` runs, per cart line,
`validateSelection` → `resolveSelection` → `calculateLinePrice`, on lines
built from the same `buildProductDetail` mapping the product page uses
(`src/lib/menu/model.ts`), read live rather than from the 60-second cache
(`getLiveCatalog`). That mapping is where per-product overrides, sold-out
flags and event menus are applied.

| Also in the engine | Job |
| ------------------ | --- |
| `calculateOrderTotal(input)` | The whole order, in the order above; `invalid_lines` / `invalid_tip` instead of a total when something is wrong |
| `evaluatePromo(promo, …)` | Active, started, not expired, total and per-customer limits, value, minimum spend, cap |
| `calculateTip(choice, …)` | Presets only from settings; custom within the cap |
| `divideRounded`, `percentOf`, `taxRateUnits` | The integer rounding above |

### What checkout re-validates

Menu-page state is not trusted, at the cart or at checkout. On every cart
load and change, every checkout quote, and again inside `createCheckout`, the
server re-checks each line against the live catalogue for the **selected**
location (from its cookie, never from the browser's claim): removed or
inactive products, not on this location's menu, sold out, a selection that
no longer validates, a changed price, a line added for another location. It
also re-checks the location (paused and pop-ups outside their window block
checkout; closed allows scheduling for the next open day), the pickup time,
the promo for this customer and spend, and the tip. The payment webhook
checks the location once more before placing the order.

---

## The storefront: locations, menu and cart

### Locations and status

The selected pickup location is kept in an `httpOnly` cookie (`dc_location`,
a location id and nothing else), so Server Components render the right menu
and status in the first response. The `selectLocation` Server Action accepts
only a location that is currently offered: the cafe, or a pop-up whose window
is running or still to come. A missing or stale cookie falls back to the
cafe.

`getLocationStatus()` (`src/lib/locations/status.ts`) is a pure function of
the location, its weekly hours, closures, the pause toggle, the global
`orders.accepting_online_orders` setting, and `now`, all in Honolulu time.
Strongest rule first:

1. **Events** are open only inside `starts_at`–`ends_at`. Outside it:
   `Event · Oct 8, 10:00 AM – 3:00 PM`.
2. **A closure row** for the day replaces the weekly hours, either closed all
   day or holiday hours. The location's own row beats an all-locations row.
3. **Weekly hours**; several rows on one day are split hours. Open means
   `opensAt <= now < closesAt`, so at 4:00:00 PM a 4 PM close is closed.
4. **Paused** applies only while it would otherwise be open. Outside hours
   the label says `Closed · Opens Fri 6:30 AM`, which is the more useful
   thing to know.

The label, today's hours and an "ordering unavailable" sentence are computed
on the server and passed down as plain strings. The same function will
re-check at checkout.

### Menu data and caching

| Data | Freshness | Where |
| ---- | --------- | ----- |
| Catalogue: categories, products, sizes, modifiers, links, collections, event menus | Cached across requests for 60 s, tag `menu` | `src/lib/menu/catalog.ts` (`unstable_cache`) |
| Sold-out flags | Every request, `no-store` | `src/lib/menu/availability.ts` |
| Locations, hours, closures, pause toggle, global switch | Every request, `no-store` | `src/lib/locations/storefront.ts` |

The cached catalogue is read with a cookie-less anon client
(`src/lib/supabase/public.ts`), so a cached answer is exactly what any guest
would see and can never carry one customer's data to another. Phase 9's menu
editor should call `revalidateTag("menu", "max")` after a save, so changes
appear immediately rather than within a minute. The storefront reads its
cookie before querying, which marks the route as per-request, and its
queries are explicitly `no-store`, so nothing time-sensitive is ever cached,
not even during `next build`.

The project uses Next's previous caching model (no `cacheComponents`).
`unstable_cache` is the supported tool there; moving to Cache Components and
`"use cache"` is a separate, app-wide change to plan on its own.

`src/lib/menu/model.ts` turns catalogue rows into what pages render and what
the pricing engine validates. It applies per-product overrides, sold-out
flags and event menus. A pop-up with no `event_menu_items` shows "menu coming
soon", not the whole catalogue. A product in a switched-off category is
hidden. Photos are either Storage paths or full URLs into this project's
public Storage, the only images `next.config.ts` allows. Anything else, or
no photo at all, shows a generated brand-coloured placeholder. A collection's
`accent_color` must look like a colour before it reaches an inline style.

### Routes

```
(shop)/layout.tsx          header (location + cart), tab bar, cart sync
(shop)/page.tsx            Home: active-order cards, favourites row, order again
(shop)/menu/page.tsx       the menu, server-rendered
(shop)/menu/[slug]         full product page: shared links, refreshes
(shop)/menu/@modal/(.)[slug]
                           the same product as a sheet / dialog when opened
                           from the menu (intercepting + parallel routes)
(shop)/cart                the cart; guests welcome
(shop)/checkout            signed-in only; sends guests to /sign-in?next=/checkout
(shop)/orders              history: active (live) + past (keyset "Load more")
(shop)/orders/[id]         live tracker; owner only (404 otherwise)
(shop)/orders/[id]/confirmed   Stripe's return_url; owner only (404 otherwise)
(shop)/account/favorites   favourites: rename, delete, add to cart
(shop)/rewards             Overflow Rewards; public (guests get the programme explained)
api/webhooks/stripe        payment webhook (outside the proxy matcher)
api/cron/expire-orders     unpaid-checkout expiry (outside the proxy matcher)
api/cron/expire-points     points expiry, off by default (outside the proxy matcher)
api/cron/send-emails       email outbox sweep (outside the proxy matcher)
api/staff/orders/[id]/cancel   cancel-with-refund for staff (session + same-origin JSON)
staff                      the barista dashboard (staff and admins; ?location= deep link)
```

Closing the sheet calls `router.back()`, so the menu keeps its scroll
position. Focus returns to the card that opened it (`useRouteDialogFocus`),
because Radix would otherwise send focus to a `Dialog.Trigger` this route
does not have.

### Cart

A Zustand store persisted to `localStorage` (`src/lib/cart/store.ts`). Each
line holds the location id, product and size ids, the pruned modifier
selection, special instructions and quantity, plus a display snapshot: names,
a summary, and the unit price when it was added. The snapshot is only for
display. The server re-validates and re-prices every line from the ids.
Identical lines merge (capped at 99). The store hydrates after the first
render, so server and client HTML agree. Because it lives in the browser, the
cart survives signing in.

The cart page (`src/components/cart/cart-view.tsx`) sends the lines to
`checkCartAction` on load and after every change and shows what comes back
per line. Price changes are applied to the stored lines automatically, with
a notice ("$4.50 → $5.00 each"). Blocking problems (gone, sold out, invalid
choices) must be fixed or removed before Checkout unlocks. Lines added for
another location are flagged, with one button to re-home them to the
selected one. **Edit** opens the same product sheet, prefilled from the line
(`ProductCustomizer`'s `editing` mode), and replaces the line in place.

The cart remembers the order it was checked out as (`pendingOrderId`) and
empties only when the confirmation page sees that order **Placed**. A
declined or abandoned payment leaves the cart as it was.

---

## Checkout and payments

### The whole flow

```
 browser                          server                                     Stripe
 ───────                          ──────                                     ──────
 /checkout loads ── quoteCheckoutAction ─▶ re-check lines, pickup options,
                                           promo, tip → calculateOrderTotal
 Payment Element + Express Checkout Element render from the quoted amount
 (deferred intent: no PaymentIntent exists yet)

 tap Pay ─ elements.submit()  (is the card form complete?)
         ─ createCheckoutAction(choices + idempotency key) ─▶
                                  rate limit (user + IP), every check again,
                                  create_checkout_order: pending_payment
                                    order + snapshot lines, one transaction
                                  create PaymentIntent (order id in metadata,
                                    idempotency key) ─────────────────────────▶ PI
                                  ◀── client secret (never stored)
         ─ stripe.confirmPayment(return_url = /orders/{id}/confirmed) ───────────▶ charge,
                                                                                  3-D Secure
 redirected to /orders/{id}/confirmed: "Confirming your payment…", polling
                                  ◀──────────── payment_intent.succeeded ─── webhook
                                  mark_order_paid: Placed, placed_at,
                                  payment, promo redemption (one transaction)
 poll sees Placed → "Mahalo!", order number; the cart empties
```

**An order becomes Placed in the webhook and nowhere else.** A redirect back
from Stripe proves nothing (anyone can type the URL), so the confirmation page
only ever reads the order's status.

### Before payment

`src/lib/checkout/service.ts` has two entry points sharing one `prepare()`:
`quote()` for the page and `createCheckout()` for Pay. Both take the location
from the cookie, prices from the live catalogue, the promo from the database
and the totals from `calculateOrderTotal`; the browser only ever sends ids,
quantities and choices. `createCheckout` refuses a total under Stripe's 50¢
minimum.

The Pay button shows the quoted total. If the order `createCheckout` makes
comes out different (a price changed between quote and tap), the browser
does not confirm the payment: it re-quotes and asks the customer to tap Pay
again. The amount charged is always the amount that was on the button.

### Idempotency: one tap, one order

- The browser makes one key per set of choices (lines, promo, tip, pickup,
  cup name, notes, location). The same choices reuse the key, so a double
  tap, a network retry or a retry after a declined card all land on **the
  same order and the same PaymentIntent**. Changing anything starts a new
  key; the abandoned order expires (below).
- A ref, not React state, guards the button, so two taps in the same frame
  cannot both start.
- `create_checkout_order` inserts `on conflict (idempotency_key) do nothing`
  and returns the existing order. `createCheckout` then compares
  `checkout_fingerprint`, a SHA-256 of the server's own canonical form of the
  request: a key reused for a different cart is refused (`changed`), and a
  key belonging to another customer is refused outright.
- The PaymentIntent is created with Stripe idempotency key `checkout-<key>`
  and recorded in `payments`, so a retry retrieves it rather than making a
  second one. An order whose intent was cancelled answers `expired`, and the
  browser starts a fresh attempt.

### The webhook (`/api/webhooks/stripe`)

The route reads the **raw** body (`request.text()`) and verifies the
signature with `constructEventAsync`; a bad or missing signature is a 400.
`src/lib/payments/stripe.ts` turns the Stripe event into a provider-neutral
`PaymentEvent`, and `src/lib/payments/webhook.ts` handles it.

**Dedupe.** Each event id gets a `webhook_events` row. Processed already →
200 `duplicate`. Another delivery mid-way (a `processing` claim under two
minutes old) → 409, so Stripe tries again later. A failed or stale attempt is
re-claimed with a compare-and-set on `attempts`, so only one delivery wins. A
handler error → 500 and the row is marked `failed`; Stripe redelivers with
backoff.

| Event | What happens |
| ----- | ------------ |
| `payment_intent.succeeded` | The location is re-checked first. Paused, closed for the chosen time or a pop-up that has ended → the payment is recorded, the order cancelled with a reason the customer sees ("… You've been refunded in full.") and the whole amount refunded. Amount or currency not matching the order → payment recorded, order **not** placed, `flagged_for_review_at` + `review_reason` set and an error logged for an admin. Otherwise → Placed, `placed_at`, payment `succeeded` with its charge id, promo redemption recorded and counted. |
| `payment_intent.payment_failed` | Payment `failed` with the decline code and message. The order stays `pending_payment`, so the same intent can be paid again. |
| `payment_intent.canceled` | A pending order is cancelled ("The payment was cancelled before it completed."). Anything already placed is left alone. |
| `charge.refunded` | Every refund on the charge is recorded (ours are matched by the `refund_row_id` metadata; ones made in the dashboard are added). `refunded_cents` is updated. Fully refunded → the order is cancelled if still running, then Refunded. |

**Out of order and replayed.** Every SQL function locks the order or payment
row and only moves forward. A replayed success is `already_placed` and counts
the promo once (`unique (promo_id, order_id)`). A late failure never
overwrites a success or a refund. A cancel never touches a placed order.
Refund totals never go down. A success for an order already cancelled
(expired, account deleted) is `not_pending`, and whatever has not already
gone back is refunded.

### The confirmation page (`/orders/[id]/confirmed`)

Stripe's `return_url`, reached after a card payment, a 3-D Secure challenge
or a redirect-based method. Only the order's owner can open it: the order is
read under RLS **and** its `user_id` compared, so staff, who may read orders
at their location, still get a 404. While the order is `pending_payment` it
polls every 1.5 s (5 s after 45 s). Placed → order number, pickup place and
time, items, totals, "Mahalo!", and the cart is emptied. A failed payment →
"Try paying again" on the **same order**: `resumePaymentAction` fetches the
intent's client secret from Stripe for the owner (it is never stored).
Cancelled → the reason and any refund. Once Placed, **Track your order**
leads to the live tracker (`/orders/[id]`).

### Pending orders that are never paid

`GET /api/cron/expire-orders` (README, "Scheduled jobs"), with
`Authorization: Bearer <CRON_SECRET>` compared in constant time. Orders older
than `orders.pending_expiry_minutes` (30) are expired: the PaymentIntent is
cancelled **first**, so an abandoned checkout can never be charged later; if
Stripe says it has already succeeded or is processing, the order is left for
the webhook. Flagged orders are never expired. Pending orders hold a pickup
slot only while younger than the expiry window, so a late or missing cron
run cannot fill the schedule with ghosts.

### Refunds

`PaymentProvider.refund(paymentId, amountCents?, reason)`, driven by
`src/lib/payments/refunds.ts`:

- A `refunds` row is written **before** Stripe is called. Its id goes to
  Stripe as metadata and into the idempotency key
  (`refund-<row>-<attempt>`), so a retried call cannot refund twice.
- The amount is capped at what is still outstanding: the payment minus the
  larger of `refunded_cents` and refunds already in flight.
- A provider failure is recorded (`failed`, with the reason) and reported,
  never thrown past the caller. `retryRefund()` is the admin retry (UI in
  Phase 9).

Callers today: the webhook (payment after pause or cancellation), account
deletion, and `cancelOrderWithRefund()` (`src/lib/orders/cancel.ts`), which
lets an admin, or staff rostered at the order's location, cancel a placed to
ready order with a reason and refund it, from the staff dashboard (below).

### Pickup times (`src/lib/checkout/pickup.ts`)

Pure, all in Honolulu time, unit-tested at exact instants, and run for the
quote, again at order creation and again in the webhook:

- **ASAP**: now + prep time + `orders.queue_minutes_per_order` (2) × orders
  already in the queue, rounded up to 5 minutes ("Ready around 9:40 AM").
  Only while open, and only if that is before closing.
- **Scheduled**: 15-minute slots, today only. The first is at least the prep
  time away, the last starts `orders.last_slot_buffer_minutes` (15) before
  closing. When closed now, the slots are the next open day's. Pop-ups offer
  slots only inside their window. A slot holding `orders.max_orders_per_slot`
  (8) orders shows as full.
- **Blocked**: paused, the global switch off, or a pop-up outside its window.

### Rate limiting

`src/lib/rate-limit.ts`, a fixed-window counter in Postgres
(`rate_limit_hit()`, one atomic upsert):

| Limit | Per user | Per IP |
| ----- | -------- | ------ |
| `createCheckout` | 12 / 10 min | 40 / 10 min |
| Promo codes that fail | 8 / 15 min | 25 / 15 min |

Only failed codes count, and while over the limit a code is refused without
being looked up, so guessing codes is slow. Minimum-spend answers do not
count. The IP is the first `X-Forwarded-For` entry, which Vercel's edge sets.
If the limiter itself errors, requests are allowed: an outage there must not
stop the cafe taking orders.

**Why Postgres, not Upstash Redis:** no new vendor, account or secret; the
count is exact and shared by every serverless instance; and at one cafe's
volume, one indexed upsert per checkout is nothing. Upstash would be faster
and keep the write load off the database at chain scale. The limiter sits
behind four functions in one file, so switching later touches nothing else.

### The provider seam

`PaymentProvider` (`src/lib/payments/types.ts`): `createPayment`,
`retrievePayment`, `cancelPayment`, `refund` and `verifyWebhook`, which turns
a signed request into a neutral `PaymentEvent`. Only
`src/lib/payments/stripe.ts` imports the Stripe SDK. The secret key never
leaves the server; the browser gets the publishable key and, for its own
order only, a client secret.

---

## Order tracking

### Who can change an order

Only the service role writes `orders`. Staff use `advance_order_status()`
(see "Security model"); a paid order is cancelled only by
`cancelOrderWithRefund()`, exposed to staff as
`POST /api/staff/orders/:id/cancel` (session-authenticated, same-origin JSON
only, re-checked in SQL). The staff dashboard builds on these (see "Staff dashboard").

### One order shape

`src/lib/orders/detail.ts` holds the select and the mapper (`toOrderDetail`)
that every reader uses: the server-rendered tracker (customer session, RLS,
plus an owner check so staff get a 404), the browser refetch (customer
session, RLS), the confirmation page and the email sender (service role). The
tracker, the receipt and the email therefore cannot disagree.

### Realtime: subscription, reconnect, polling fallback

`src/lib/orders/live.ts`, used by the tracker, the Home cards and the Orders
tab dot:

- **Filters.** The tracker subscribes to `orders` with `id=eq.<order>`; the
  active list and the dot with `user_id=eq.<customer>`. One channel per
  filter is shared by every component that asks for it (a small ref-counted
  registry) and removed when the last one unmounts, so the header and Home do
  not open two channels for the same thing.
- **Auth.** Before joining, the channel is given the customer's access token
  (`realtime.setAuth`); otherwise Realtime treats the socket as a guest and
  RLS sends nothing.
- **Events are signals, not data.** A change invalidates the TanStack Query
  key, and the data is refetched through RLS like any other query. Nothing
  rendered comes from the event payload.
- **Never miss an update.** A refetch also runs when the channel (re)joins,
  when Realtime reports its Postgres listener running (it acknowledges the
  join slightly earlier, and a change in that gap would otherwise be lost),
  when the tab becomes visible, and when the browser comes back online.
- **Fallback.** While the channel is not joined, the same queries poll every
  15 seconds; the tracker says "Reconnecting…".

Isolation is tested twice: `supabase/tests/realtime_isolation.test.sql` feeds
`realtime.apply_rls` a change to one customer's order with subscriptions from
the owner, another customer (even one filtered on the owner's order id), a
guest and staff; `e2e/tracking.spec.ts` does the same over real sockets.

### The tracker and the Ready alert

`buildTimeline()` (`src/lib/orders/timeline.ts`, pure, unit-tested) turns the
status and its timestamps into Placed → Accepted → Preparing → Ready → Picked
Up with times, and a cancelled or refunded order into the steps it reached
plus the reason in plain language and what happened to the money. On the
change to Ready (not on opening a page that is already Ready) the tracker
shows a banner, plays a synthesised chime if the customer has tapped the page
(browsers block audio otherwise; mute is remembered in `localStorage`),
vibrates, retitles the tab while ready, and shows a browser notification if
the customer allowed it from the in-page prompt. Permission is never asked on
page load. On Android Chrome a page notification needs a service worker,
which arrives with the PWA (Phase 10).

### History

`list_my_orders(scope, before_created_at, before_id, limit)` returns the
caller's active or past orders, newest first, with keyset pagination on
`(created_at, id)`. It is `SECURITY DEFINER` with an `auth.uid()` filter, so a
past pop-up whose location is now hidden from customers still shows its name.
"Past" includes only orders that were paid for.

---

## Staff dashboard

`/staff` is one client component (`src/components/staff/staff-dashboard.tsx`)
over a server page that decides which counter to show. Everything it reads
and writes goes through the barista's own session, so RLS and the definer
functions are the real boundary; the page only arranges the work.

### Which counter

`src/lib/staff/locations.ts` lists what the viewer may open: an admin, every
location; staff, their `staff_locations` rows. Only the cafe and pop-ups whose
window touches today (Honolulu date) are offered. The choice is `?location=`
(a deep link), else the `dc_staff_location` cookie (set by the switcher's
Server Action after checking the roster), else the first offered. A location
outside that list shows "Not your counter"; even reached some other way, its
orders, pause toggle and sold-out flags are refused by the database.

### Start shift

The queue appears only after a tap on **Start shift**, because browsers allow
sound only after a user gesture. The same tap asks for a Screen Wake Lock
(asked again whenever the tab becomes visible, since browsers drop it while
hidden; a note appears where it is unsupported) and, if ticked (remembered on
the device), fullscreen.

### The queue

`src/lib/staff/queue.ts` is pure and unit-tested; the dashboard runs it every
second against the orders it holds, so nothing waits on the server to move a
ticket between columns or change its colour.

| Column | Orders |
| ------ | ------ |
| Upcoming | Placed, scheduled, and not yet due: due = pickup time − the location's prep time |
| New | Placed: ASAP at once; scheduled once due |
| In progress | Accepted and Preparing (a badge says which) |
| Ready | Ready |

Within a column, tickets sort by pickup time, ASAP orders by when they were
placed. A ticket turns amber, then red, `staff.ticket_warning_minutes` (5) and
`staff.ticket_late_minutes` (10) after its estimated ready time (the scheduled
time, or the ASAP estimate from checkout) while it is still being made, with a
"Running behind" / "LATE" label so colour is never the only signal. Each
selection gets its own line in build order (temperature, milk, shots,
flavours, sweetness, ice, toppings, then the rest), decided by the modifier
group's slug or name (`src/lib/staff/ticket.ts`). Special instructions and
order notes are boxed; allergens are the product's plus every chosen option's.

The data is one query: orders for the location that are on the queue, or were
placed, picked up or cancelled today (for the summary and the completed
drawer). It is kept fresh by the same `useOrderChanges` hook as the customer
tracker, filtered `location_id=eq.<location>`: Realtime events (which carry
RLS-checked rows only) trigger a refetch, as do (re)joining, the listener
becoming ready, the tab becoming visible and coming back online; while not
joined it polls every 15 seconds. The pause state is re-read every 20
seconds and after each change.

**Summary strip:** orders placed today, the average minutes from entering New
to Ready (placed, or due for a scheduled order, so a pickup booked last night
is not a 12-hour wait), and how many are in New or In progress. No money.

On a phone (narrower than 1024 px) the four columns become tabs with counts.
Only one layout is rendered at a time.

### One-tap actions and the undo window

New → **Accept**, Accepted → **Start**, Preparing → **Ready**, Ready →
**Picked up**, all through `advance_order_status()`. Accept and Start are sent
at once. Ready (which alerts the customer) and Picked up (which closes the
order and credits points) are held for five seconds with a big
"Marking ready… Undo" bar on the ticket and at the bottom of the screen; only
when the time runs out is the call made. Undo simply cancels the timer, so
nothing reached the database or the customer. Closing the tab inside those
five seconds drops the action: the order stays where it was, which is the safe
way round. The database transition rules are unchanged.

**Two devices.** Before calling, the browser re-reads the order's status. If
it is no longer what the barista saw (another device got there first, or it
was cancelled), nothing is sent: the screen says "Already updated" and
refreshes. If two devices pass that check at the same moment, the second call
asks for the status the order already has, which `advance_order_status()`
treats as a no-op: no error, no second history row, no second email. A move
that has become impossible (Accept on an order already Preparing) is still
refused by the transition rules and shown as "Already updated".

**Offline.** "Offline — reconnecting…" shows while the browser is offline or
after Realtime drops. A tap while offline, or one whose request fails, says
so and changes nothing; actions are never queued for later.

### Cancel

From the ticket's detail view: a preset reason (Out of ingredient, Customer
request, Duplicate order, Unable to fulfill) or Other with a few words, then a
confirmation that states the refund in dollars before anything happens (the
refundable amount comes from `staff_order_activity`). It always posts to
`/api/staff/orders/:id/cancel` (cancel-with-refund); the tracker and the
cancellation email follow from the status change. A 409 (already cancelled
or picked up elsewhere) is "Already updated".

### Alerts

`use-new-order-alerts.ts`: an order in New that this device has not
acknowledged rings a synthesised chime at once, flashes its outline, shows a
banner with **Acknowledge**, and puts the count of New orders in the tab
title. The chime repeats every `staff.new_order_repeat_seconds` (15) until
every New order is acknowledged, by opening it, by Acknowledge, or by
accepting it. Scheduled orders alert when they fall due. Acknowledgements are
kept in `localStorage` per location, so a reload does not ring again for
orders already seen; volume and mute are remembered per device too.

### Sold out and the end-of-day reset

`set_sold_out(location, product | option, sold_out, until)`. "Until end of
day" (the default) stores `available_from` = the start of the location's next
trading day: the first opening on a later Honolulu date than today, with
closures and holiday hours applied (`endOfDayResetAt`, unit-tested). Marked
at 2 PM or at 6 AM before opening, it lasts until tomorrow's opening; the
afternoon half of a split day does not reset it. Pop-ups reset at the next
Honolulu midnight. "Until I turn it back on" stores null. Nothing runs at the
reset time: every reader already treats a flag whose `available_from` has
passed as gone, so the menu and cart checks (read live, never cached) change
the moment it is set and the moment it lapses.

### Pause

`set_location_accepting_orders(location, false, resume_at?)` with 15, 30 or 60
minutes, or until resumed (at most 12 hours ahead). Auto-resume is lazy, like
the sold-out reset: `isAcceptingOrders()` treats a pause whose `paused_until`
has passed as over, and the storefront, checkout and the payment webhook all
read the toggle through it. The dashboard shows a banner with a countdown and
**Resume now** while paused.

### Catering and printing

**Today's catering** lists confirmed requests at this counter for today
(`staff_catering_prep`): time, headcount, items, pickup or delivery, contact
name and phone, notes. Read-only until Phase 8.

**Printing** renders a print view into a portal only while printing; a
`staff-printing` class on `<body>` hides the rest of the page, and an `@page`
rule is added for that one print: the label size (`staff.label_width_mm` ×
`staff.label_height_mm`, 57 × 32 mm) for cup labels, one label per drink; for
tickets zero margins and a `staff.receipt_width_mm` (80 mm) column. Silent
printing needs Chrome's kiosk mode (README, "Kiosk printing").

---

## Email

### Outbox

Emails are owed by status changes, so the database writes them: the
`orders_enqueue_emails` trigger inserts into `email_outbox` in the same
transaction as the change.

| Change | Email |
| ------ | ----- |
| → placed | receipt |
| → cancelled, after money was taken | cancellation, with the refund |
| picked_up → refunded | refund |
| → ready | only if the customer turned it on (`notification_prefs.order_ready_email`, off by default) |

An unpaid checkout that expires owes nothing; cancelled → refunded owes
nothing more. `dedupe_key` (`kind:order_id`) is unique, and a replayed webhook
never changes the status, so a replay can never send a second receipt.

The sender (`src/lib/email/outbox.ts`) claims due rows with
`claim_email_outbox()` (`FOR UPDATE SKIP LOCKED`, so two runs never send the
same row), builds each email from the order **as it is now**, sends it and
marks it `sent`. If the email is no longer owed (no recipient after an
account deletion, ready email turned off, order no longer ready) it is
`skipped`. A failure is retried after 1, 5, 15, 60 and 240 minutes, then left
`failed` for the admin screen (Phase 9). The outbox row id is the provider
idempotency key, so a crash between sending and marking sent does not
duplicate the email with Resend.

It runs after the response (`after()`) from the payment webhook and the staff
cancel endpoint; from `GET /api/cron/send-emails` (cron secret); and every 15
seconds under `npm run dev` (`src/instrumentation.ts`). A webhook never fails
because of email.

### Providers and templates

`EmailProvider.send()` (`src/lib/email/provider.ts`) has two
implementations: **Resend** when `RESEND_API_KEY` is set, otherwise the local
Supabase stack's **Mailpit** through its HTTP send API, so development needs
no account. Templates are React Email components in `src/emails/`: the
lowercase wordmark on a deep-teal header (logo placeholder), deep magenta
accents, near-black text, all AA. Every value arrives preformatted, and each
email has a plain-text version built from the same data. Receipts and refund
emails are transactional and always sent.

---

## Reorder and favourites: re-validating saved drinks

A past order line and a favourite are both a *saved drink*: product, size and
the modifier snapshot. `reviewSavedLine()` (`src/lib/orders/reorder.ts`,
pure, unit-tested) rebuilds the selection from the snapshot and puts it
through the same engine as the product sheet and checkout, against the live
catalogue and sold-out list at the **selected** location
(`loadReviewContext`):

- gone, not on this location's menu, sold out, size removed, an option
  removed or sold out, or a selection that no longer validates (e.g. a newly
  required group) → **unavailable**, with the reason, and skipped. An
  unavailable option skips the whole line rather than silently changing the
  drink
- otherwise → a cart line priced from today's catalogue; for order lines, a
  different price is flagged ("$6.30 → $6.55 each")

Snapshot prices are never reused; the cart and checkout re-price on the
server as for any line. **Order again** shows the review first, notes when the
order was from another location (offering to switch if it is still offered),
and, if the cart already has items, asks whether to add or replace.
**Favourites** are re-checked the same way when listed (cached menu, display
only) and again, live, the moment one is added to the cart; an unavailable
favourite stays saved and says why it can't be added.

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

## Overflow Rewards

Every rule the cafe has not confirmed is a setting or a data row, so their
answers are a settings change, not a code change (all `NEEDS_CONFIRMATION`):

| Setting | Default | Meaning |
| ------- | ------- | ------- |
| `loyalty.points_per_dollar` | 1 | Points per dollar of the eligible amount, up to two decimals |
| `loyalty.catering_earns_points` | false | Read by `pointsForOrder(…, "catering")` when catering payments arrive (Phase 8) |
| `loyalty.points_expire_after_months` | 0 | 0 = never. Expiry is built and runs from the ledger alone |
| `loyalty.max_rewards_per_order` | 1 | The engine, the schema and the picker all handle more |
| `loyalty.allow_promo_with_reward` | false | One discount per order: a promo or a reward |

Tiers are rows in `rewards` (seeded 50 / 150 / 250 points; see the seed).

### The ledger

`loyalty_transactions` is append-only and signed; `profiles.loyalty_points` is
a cached sum kept by an `AFTER INSERT OR DELETE` trigger. Every balance on
every page is that cached sum, read on the server; nothing adds points up in
the browser. Nobody but the SQL functions writes the ledger: `anon` and
`authenticated` (admins included) have no INSERT, UPDATE or DELETE, and a
trigger refuses any UPDATE except a reference going null (`ON DELETE SET NULL`
when an admin's account or a reward is deleted). A correction is a new
`adjust` row.

| Type | Sign | Written by | When |
| ---- | ---- | ---------- | ---- |
| `earn` | + | `sync_order_loyalty` | The order is picked up. One per order (unique index) |
| `redeem` | − | `create_checkout_order` | Checkout creates an order with a reward. One per reservation |
| `release` | + | `sync_order_loyalty` | A reservation is given back. One per reservation |
| `reverse` | − | `sync_order_loyalty` | A refund after pickup (topped up as further refunds arrive) |
| `adjust` | ± | `admin_adjust_points` | An admin correction: reason required, admin recorded in `created_by` |
| `expire` | − | `expire_loyalty_points` | Points past the expiry age, when expiry is on |

The activity log (`list_my_points_activity`) shows a `redeem` row as
**Reserved** until its order is paid and **Redeemed** after.

### Earning

`pointsForOrder` (`src/lib/pricing/points.ts`) works the points out at
checkout from the breakdown's `taxableCents`: the subtotal after the promo
and the reward, before GET and tip, so the part a reward paid for earns
nothing. Rounded down to a whole point. The order stores it
(`orders.points_earned`); receipts say "You'll earn N points when you pick
this up"; the database credits it at pickup. An order cancelled before pickup
earns nothing. The rate in force at checkout is the one used.

### Reservations

`create_checkout_order` writes the order, its lines, the `order_rewards`
snapshot and the reservation in one transaction. It locks the customer's
`profiles` row (`FOR UPDATE`) before checking the balance, so two checkouts
racing for the same points run one after the other and the second sees what
the first spent: it fails with `DC004` and its order rolls back.
`supabase/tests/points_race.concurrent.mjs` proves this with real sessions.

```
held ──(order Placed: payment, or a $0.00 order placed at once)──▶ redeemed
  │                                                                    │
  └──(expired / payment cancelled / order cancelled)──▶ released ◀──(fully refunded)
```

- The points leave the balance when the reservation is made, so the
  customer cannot spend them twice while paying.
- A payment that fails is retried on the same order and the points stay held.
  If the customer changes their order after submitting it, the new attempt
  names the old one (`replacesIdempotencyKey`); checkout cancels that unpaid
  order (PaymentIntent first) and its points come back before the new
  reservation is made. Points held by a checkout in another tab show on the
  picker with a button to cancel it, and otherwise come back when the expiry
  job cancels it.
- A **partial refund never returns redeemed points**; only a full refund (or
  a cancellation) does.

### One reconcile for every path

`sync_order_loyalty(order)` makes the ledger agree with one order. Triggers
run it after every status change on `orders` and every change to
`payments.refunded_cents`, so it holds whatever moved the order: the webhook,
the staff screen, the expiry job, a refund, account deletion or psql. It only
appends what is missing, and the unique indexes make a repeat a no-op, so a
replayed or out-of-order webhook cannot credit, redeem or return points twice
(on top of the Phase 4 event dedupe).

### Refunds and negative balances

The reversal is the earned points times the share of the payment refunded so
far, **rounded down**; all of them once the order is fully refunded. A second
partial refund tops it up against the running total. `pointsToReverse` in
TypeScript mirrors the SQL and the two test suites use the same cases.

If the customer has already spent the points, the reversal still happens and
the balance goes below zero (the old `>= 0` check is gone). The ledger stays
exact, and a negative balance simply cannot redeem anything until new orders
bring it back up. The rewards page says so.

### Redemption at checkout

`applyRewards` (`src/lib/pricing/rewards.ts`) runs inside
`calculateOrderTotal`'s reward slot, after the promo and before GET:

- **free_item**: one unit of an eligible line free, worth at most the cap
  (`value_cents`). By default (`covers_modifiers = false`) the cap covers the
  size price and add-ons are charged; with `covers_modifiers` the add-ons
  count towards the cap.
- **free_modifier**: one unit of one priced add-on from the listed groups
  (one shot, or one flavour's single charge), capped likewise.
- **amount_off**: a fixed amount off the order.

Eligibility is data: product and category lists (both empty = anything), and
for add-ons the modifier groups. Item rewards go on the line where they are
worth most (the highest-priced eligible line; ties go to the higher unit
price, then cart order), or a line the customer picks. Several rewards never
free the same unit twice, no line goes below zero, and together they never
exceed the subtotal less the promo. A reward that cannot be used is refused
with a reason and its points are not spent. The 250-point tier is an
amount off ($12.50) rather than "a drink and a pastry": one reward row is one
discount, and a bundle would need two lines and two caps.

A reward that pays for the whole order makes it $0.00: checkout places it
through `place_free_order` (no card), the only path to Placed besides
`mark_order_paid`. Between $0.01 and $0.49 Stripe's minimum applies and the
customer is asked to add a tip or an item.

Receipts, the tracker, emails and the staff ticket read `order_rewards`
(name, cost, discount, the line, the free add-on), so "Free drink: Latte,
−$5.75" is printed from the order, not recomputed.

### Member codes

`profiles.member_code` is 12 random characters from Crockford's base 32 (60
bits); it holds nothing personal and `regenerate_member_code()` retires it at
once. `staff_lookup_member(code)` (staff and admins) forgives case, spaces,
dashes and the look-alikes O/I/L, and returns only a first name and a
balance. The QR (drawn with `uqr` as an inline SVG) encodes the bare code.

### Expiry (off)

`expire_loyalty_points()`, via `GET /api/cron/expire-points`, expires the
oldest points first using the ledger alone: credits older than the cutoff
minus every debit ever (a released redeem and its release cancel out). With
the setting at 0 it does nothing, so the job can be scheduled now.

### Account deletion

Cancelling the open orders releases any held points (the trigger), then the
whole ledger and every reservation are deleted with the account.
`order_rewards` stay with the anonymised orders: they hold no personal data.

---

## Time handling

`src/lib/time.ts` is the only place instants convert to Hawaii wall time.
Instants are stored and passed as UTC `timestamptz`; `location_hours` stores
wall-clock `time` values, and `cafeDateAtTime()` combines a calendar day with
one to produce a comparable instant.

Because Hawaii has no daylight saving there are no spring-forward gaps or
repeated hours to special-case — a simplification the rest of the scheduling
logic leans on.

Postgres has matching helpers: `cafe_date(instant)`, `cafe_today()` and
`cafe_clock()`.

---

## Dev server: the one-off 500

Under `npm run dev`, opening `/menu/kona-drip-coffee` once returned a 500
with `at matchAll.next` in the stack, then 200 on reload. Investigated in
Phase 4 (Part 0); it is a development-server effect, not an application bug.

- **Where it comes from.** `matchAll` is Next's route matcher, an async
  generator walked in `base-server.js` (`renderToResponseImpl`). In dev,
  `DevRouteMatcherManager.matchAll` compiles each route on first request
  (`ensure`) and reloads the route table before yielding. Anything thrown
  there becomes a 500 with that frame. Our page code runs *after* the match,
  so an error in it would not show `matchAll.next`.
- **What triggers it.** An on-demand compile that runs while a source file is
  being written: an editor save, a `git stash` or checkout swapping files, or
  generated types being rewritten. Reproduced on a cold dev server by
  truncating `src/lib/menu/model.ts` mid-request: 500 while the file was
  half-written (`Expected '}', got '<eof>'`), 200 on the next request. The
  reported 500 happened while the dev server was running during Phase 3/4
  file changes.
- **What does not trigger it.** A stable tree: three cold dev starts loading
  the URL in a real browser, and six different routes requested concurrently
  on a cold dev server, all returned 200.
- **Why production is immune.** `next build` compiles every route ahead of
  time, and `next start` loads the route table once at startup; the
  production matcher never compiles or reloads per request. Three cold
  `next start` runs, each opening the product URL first, returned 200.
  `e2e/cold-start.spec.ts` keeps it that way: it starts a fresh production
  server and makes the product page its very first request.

If it appears in dev, reload. If it persists, the terminal shows a real
compile error to fix.

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

Known follow-ups for later phases:

- **Condition cycles** (Phase 9 admin): the database accepts group A shown
  when B's option is chosen *and* B shown when A's option is chosen; the
  engine would then hide both. The menu editor should refuse cycles.
- **Deleting orders that have items:** `freeze_order_items` blocks deleting
  items of any order past `pending_payment`, cascades included, so a placed
  order cannot be deleted outright. That is deliberate for real data, but the
  seed script's wipe will need `npm run db:reset` instead once real orders
  exist locally.

---

## Post-launch

Agreed for after launch (Decisions Log, Phases 2, 5 and 7). v1 auth is email +
password only, order updates are in-app and by email only, and points are
earned online only.

### In-store scanning and POS point earning

The member QR on `/rewards` and `/account` encodes an opaque code, and
`staff_lookup_member(code)` already returns the member's first name and
balance to staff. Still to build: a scanner on the staff screen (camera via
`BarcodeDetector`, or a USB scanner typing into a field), crediting in-store
purchases (a staff `earn` path keyed to a till receipt, so one purchase cannot
be credited twice, with a daily per-member cap), redeeming at the counter, and
a POS integration if the cafe's POS can send sales (`NEEDS_CONFIRMATION`:
which POS). Rate-limit lookups per staff member before it ships.

### SMS order updates

The `sms_opt_in` preference exists (off by default; the account page needs a
phone number to turn it on) and is kept, but nothing sends texts in v1. To
add it: an `SmsProvider` beside `EmailProvider`, an `sms` channel on the
outbox (same trigger, retries and dedupe), STOP / HELP handling with opt-outs
synced from the provider's webhook, and the 10DLC registration US carriers
require for business texting.

### Changing email address

`profiles.email` is copied from `auth.users` at sign-up and never updated. To
add it:

- a form on `/account` calling `supabase.auth.updateUser({ email })`. With
  email confirmation on, Supabase emails both addresses, and those links
  already land on `/auth/callback`, which accepts the `email_change` OTP type
- an `AFTER UPDATE OF email ON auth.users` trigger that copies the confirmed
  address into `profiles.email`. Do not copy it from the form, which only
  records a request.

### Google and Apple sign-in

What is already in place, so adding them should not mean reworking auth:

- **Callback.** OAuth returns a PKCE `code` to `/auth/callback`, which already
  exchanges it for a session and honours a sanitised `?next=`.
- **Profile creation.** `handle_new_user()` reads the display name from
  `full_name` or `name`, which is what those providers send. It still never
  trusts `role`, and marketing opt-in stays off unless explicitly `true`.
- **Route gating** reads the role from `profiles`, not from how the user
  signed in, so the proxy and `requireRole()` need no changes.
- **Re-authentication** for sensitive actions sits behind
  `src/lib/auth/reauthenticate.ts`. A social-only account has no password, so
  account deletion will need a second check there: a fresh OAuth round trip,
  or `supabase.auth.reauthenticate()` with an emailed code. Callers only look
  at the pass/fail result.

Still to do: add `signInWithOAuth({ provider, options: { redirectTo:
callbackUrl(next) } })` buttons to the sign-in and sign-up pages; enable the
providers in the Supabase dashboard (and `[auth.external.*]` in
`supabase/config.toml` for local); for Apple, set up the Services ID, key and
domain verification; and decide how an existing email + password account
links to a social login with the same address (Supabase links verified
emails automatically).

# Architecture

How Drincup Cafe's order-ahead app is put together: the data model, the order
lifecycle, the catering workflow, events and seasonal collections, the admin
shell, and where pricing is decided.

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

41 tables in `public`. Grouped by what they are for:

### People and places

| Table | Purpose |
| ----- | ------- |
| `profiles` | One row per `auth.users` row. Carries `role`, loyalty balance, member code, notification preferences. |
| `staff_locations` | Which baristas see which queues. Admins bypass it. |
| `locations` | The Kapiolani cafe (`type = 'cafe'`) and pop-up booths (`type = 'event'`, with `starts_at`/`ends_at`, at most 24 hours: one row per day). Events are `is_published` or drafts invisible to customers, with an optional `map_url`. The staff pause toggle is `accepting_orders`, with `paused_until` (automatic resume), `paused_at` and `paused_by`. `created_by` / `updated_by` record the admin. |
| `location_hours` | Weekly opening hours. Multiple rows per day allow split service. |
| `closures` | One-off closures and holiday-hour overrides. A null `location_id` applies everywhere. |

### The menu

| Table | Purpose |
| ----- | ------- |
| `categories` | Coffee & Espresso, Tropical Refreshers, Shave Ice, … |
| `products` | Name, description, allergens, dietary tags, catering eligibility, and an optional availability window (`available_from` / `available_until`) for limited-time items. |
| `product_sizes` | Each size carries its own **absolute** price, not a delta — a large cold brew is not reliably "small plus a fixed amount". |
| `modifier_groups` | Reusable customisation groups: Milk, Syrups, Sweetness, Ice. `quantity_unit` names one unit ("pump", "shot"); `charge_per_quantity` says whether a delta is charged per unit (extra shots) or once (a flavour at any number of pumps). |
| `modifier_options` | The choices inside a group, each with a `price_delta_cents`. |
| `product_modifier_groups` | Links products to groups, with optional per-product overrides of required/min/max, and `visible_when_option_id` for conditional groups. |
| `location_availability` | Sold-out overrides. **A row exists only when something is unavailable** — no row means available. `available_from` is the automatic reset ("until end of day"); null means until someone turns it back on. Written only through `set_sold_out()`. |
| `location_availability_log` | Append-only: who marked what sold out or back on, where and when (trigger on `location_availability`). Readable by staff of that location. |
| `event_menu_items` | The subset of the catalog a pop-up booth carries. A published event always has at least one (checked at commit). |
| `collections` / `collection_products` | Seasonal ranges, shown and hidden purely by date window, products in order. Hex-only `accent_color`; `created_by` / `updated_by`. |

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
| `payments` | Provider-agnostic. Only Stripe identifiers and status — card data never reaches us. Never stores a client secret. Records the last failure (`failure_code`, `failure_message`), the running `refunded_cents`, and for the receipt the card brand, last four and wallet (`method_*`, copied from the charge by the webhook). Belongs to an order **or** a catering request (and its quote): exactly one. |
| `refunds` | One row per refund attempt, written **before** the provider is called, so a crash or a decline still leaves a record. `failed` rows are the admin retry queue. Customers can read refunds on their own orders and catering requests. Like payments, for an order or a catering request. |
| `webhook_events` | One row per provider event id: the dedupe log. Service role only. |
| `rate_limit_hits` | Fixed-window counters for checkout and promo-code limits. Service role only. |
| `email_outbox` | Emails owed by order and catering changes, written by trigger in the same transaction and delivered by the server-side sender. Unique `dedupe_key` (kind + order, request, quote or message). Admins can read it; only the server writes. |
| `push_outbox` | Push notifications owed ("Your order is ready"), written by trigger when an order turns Ready and its customer has a device; delivered by the server-side sender, which records the devices reached. Admins can read it; only the server writes. |
| `push_subscriptions` | One row per browser that turned order notifications on: the push service endpoint (https on a known push service), the encryption keys and a device label. Added only by the server; customers read and delete their own. |

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
| `catering_requests` / `catering_request_items` | Enquiries and what was asked for (product, size, quantity). `location_id` is the counter that prepares it (the cafe). `current_quote_id` is the payable (or paid) quote. The admin inbox's "new" marker is `admin_attention_at` after `admin_seen_at`. Contact fields and `user_id` are cleared by account deletion (`anonymized_at` set). |
| `catering_quotes` / `catering_quote_lines` | Versioned quotes: immutable once issued, one `active` at a time, earlier versions kept `superseded`; `paid` or `void` at the end. Totals from `calculateCateringQuote`, checked to add up by constraint. |
| `catering_messages` | Change requests, cancellation requests and notes sent with a quote. |
| `catering_status_history` | Every status change with its actor, written by trigger. |
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
- **Catering is written only by functions.** Nobody (admins included) has
  INSERT, UPDATE or DELETE on `catering_requests`, their items, quotes,
  quote lines, messages or history. The server creates requests
  (`create_catering_request`, after Zod, the delivery-area check and the
  rate limit) and quotes (`catering_issue_quote`, totals from
  `calculateCateringQuote`, the admin named and re-checked); customers act
  through definer functions that check `auth.uid()` owns the request; staff
  read only `staff_catering_prep()` (no prices). Another customer's id gets
  the same 42501 as a missing one.
- **Admin tools are definer functions too** (`admin_save_event`,
  `admin_set_event_published`, `admin_duplicate_event`,
  `admin_save_collection`, `admin_catering_cancel`), each starting with
  `is_admin()` and running as the admin, so `created_by` / `updated_by`
  stamps (trigger) name who did it.
- **Images:** admins upload (Storage policy plus the upload action);
  guests and customers may list only images that published content uses.
  The buckets are public so `next/image` can load published images by URL;
  a public bucket serves any object to whoever has its exact URL, which no
  policy can prevent, so uploads get random names and a draft's image is
  never guessable.
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

`/staff`, `/admin` and `/catering/[id]/pay` are also gated in `src/proxy.ts` before any page code
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
3. **Weekly hours**; several rows on one day are split hours (rows that touch
   merge). Open means `opensAt <= now < closesAt`, so at 4:00:00 PM a 4 PM
   close is closed. A `24:00` close is the next midnight, and a day that
   runs into a day opening at midnight stays open across it ("Open 24 hours").
4. **Paused** applies only while it would otherwise be open. Outside hours
   the label says `Closed · Opens Fri 6:30 AM`, which is the more useful
   thing to know.

The label, today's hours and an "ordering unavailable" sentence are computed
on the server and passed down as plain strings. The same function will
re-check at checkout.

Hours and closures always enter through `openingHours()`
(`src/lib/locations/opening-hours.ts`), used by the storefront, checkout and
webhook, and staff loaders. Local test mode (`TEST_STORE_ALWAYS_OPEN`, guarded
in `src/lib/test-mode.ts` to dev builds on a local database) swaps them there
for "open 24 hours, no closures", so every check above follows without its own
branch. No SQL function reads hours (`supabase/tests/store_hours.test.sql`).

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
(shop)/catering            catering: what we offer (public) and the request form (signed in)
(shop)/catering/[id]/pay   pay a quote (owner only; current, unexpired, before the deadline)
(shop)/account/catering    the customer's requests; /[id] for one, with its quote and history
(shop)/events              live and upcoming published pop-ups; /[slug] for one
(shop)/collections/[slug]  a seasonal collection; "has ended" after its window
admin                      admin home; catering (inbox + calendar, /[id]), events, collections
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

**An order becomes Placed from Stripe's word, never the browser's.** A
redirect back from Stripe proves nothing (anyone can type the URL), so the
confirmation page only ever reads the order's status. Stripe's word arrives
by the webhook, or, when that is slow, by the reconcile fallback (below):
the server reading the PaymentIntent from Stripe's API with the secret key.

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

**Catering payments** arrive as the same four events. The handler finds the
owner from our `payments` row (or, before it exists, the PaymentIntent's
metadata: `type=catering` with the request and quote ids) and routes them:
success → `mark_catering_paid` (see "Catering workflow"), failure and
cancellation → the payment row only (the quote stays payable), refunds →
`apply_refund_state`, which cancels a confirmed request once its paid quote
is fully refunded.

**Out of order and replayed.** Every SQL function locks the order or payment
row and only moves forward. A replayed success is `already_placed` and counts
the promo once (`unique (promo_id, order_id)`). A late failure never
overwrites a success or a refund. A cancel never touches a placed order.
Refund totals never go down. A success for an order already cancelled
(expired, account deleted) is `not_pending`, and whatever has not already
gone back is refunded.

### The reconcile fallback

A late or lost webhook (the listener down, a deploy in the way) would leave
a customer on "Confirming your payment…". So the confirmation page, and the
catering pay page, ask the server to reconcile after 6 seconds of waiting:
`reconcileOrderPayment` / `reconcileCateringPayment`
(`src/lib/payments/reconcile.ts`) check the caller owns the order or request
and it is still waiting, read the latest PaymentIntent from Stripe, and if it
has succeeded run `applyPaymentSucceeded`, exactly the webhook's handler
(location re-check, `mark_order_paid` / `mark_catering_paid`, card details,
refund on rejection), then send the emails it owes. Nothing is recorded in
`webhook_events` (it is not a provider event), and every step is row-locked
and forward-only, so the real webhook arriving later, or at the same moment,
changes nothing twice. One provider read per payment per 8 seconds (the
Postgres limiter), however many tabs poll.

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
vibrates, retitles the tab while ready, bursts a little confetti (motion-safe
only) and shows a notification if the customer turned them on with the
in-page button. Permission is never asked on page load. Since Phase 10 the
notification goes through the service worker (Android Chrome requires it),
and the button subscribes the device to Web Push where it can, so "ready"
also arrives with the app closed (see "Push notifications").

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
                 ┌─── changes asked for ───┐
                 ▼                         │
  submitted ──► quoted (v1, v2 …) ──────────┘
      │           │  paid (webhook or reconcile)
      │           ▼
      │       confirmed ──► fulfilled   (admin or staff, from the event day)
      │           │
      └───────────┴──► cancelled        (free before payment; after it,
                                          admin only, with a refund)
```

`is_valid_catering_transition()` is the enforcing copy, a trigger stamps
the timestamps, and `CATERING_TRANSITIONS` (`src/lib/catering/status.ts`)
mirrors it with a parity test, the same as orders. Every change lands in
`catering_status_history` with its actor: `auth.uid()` for customer and
admin functions run in the session, the admin a service-role function names
(`app.catering_actor`) for quoting and cancel-with-refund, null for the
webhook. Request numbers follow the order-number pattern: `CAT-260923-004`.

### Requesting (`/catering`)

Guests read what catering offers, the lead time and how quoting works, and
are asked to sign in. The form takes the event date and time (Honolulu),
headcount, drinks (catering-eligible products, a size and a quantity, from
`getCateringMenu`), an optional "custom signature drink" brief, pickup or
delivery, contact details (prefilled from the profile), a budget and notes.
`submitCateringRequestAction` validates with Zod, checks the lead time with
the request clock (`appNow`) and, for delivery, the ZIP against
`catering.delivery_zip_codes` (`checkDeliveryArea`, unit-tested), checks
each drink is a catering drink on the menu **on the event date** (its
availability window), rate-limits (5 per user / 20 per IP per hour), and
creates the request through `create_catering_request` with the cafe as
`location_id`. The lead-time trigger still has the last word. The
confirmation shows the number and what happens next.

### Quoting (`/admin/catering/[id]`)

The quote builder starts from what was asked for at today's menu prices (or
the current quote, for a revision), and takes menu lines (price editable for
catering pricing), custom lines, a delivery fee (setting default, editable),
an optional discount (amount or percent, items only), an optional gratuity
(off by default), the expiry (default 7 days, never past the payment
deadline) and a note. The preview is `calculateCateringQuote`
(`src/lib/pricing/catering-quote.ts`), the same pure function the server
runs when the quote is sent:

```
  lines      = quantity × unit price (integer cents)
  items      = Σ lines
  discount   = amount, or percentOf(items, %), capped at items
  gratuity   = percentOf(items − discount, %) or an amount   (optional)
  taxable    = items − discount
               + delivery fee  if catering.delivery_fee_taxable
               + gratuity      if catering.gratuity_taxable
  tax (GET)  = divideRounded(taxable × rate units, 100000)   once per quote
  total      = items − discount + delivery fee + tax + gratuity
```

`issueQuoteAction` re-checks the admin, recomputes, and calls the
service-role `catering_issue_quote(actor, request, quote, lines)`: it
re-checks the actor is an admin, the status (submitted or quoted), the
deadline and the expiry, supersedes the active version, inserts the next
version and its lines (a constraint checks the totals add up; the function
checks the lines sum to the items), points the request at it and records
the history ("Quote sent (version 1)", "Quote revised (version 3)"). The
customer is emailed the quote.

### Quote versions

A quote never changes once issued (a trigger allows only its status and the
superseded stamp). There is at most one `active` quote per request (unique
partial index). A revision supersedes it; a change request supersedes it and
sends the request back to submitted with no payable quote; cancelling voids
it; paying marks it `paid`. Every version stays readable by the customer and
the admin, with why it was replaced.

### The customer's side (`/account/catering`)

The list shows each request's number, status, event date and total; the
detail page shows the progress, the current quote (or receipt) with its pay-by
time, earlier versions, what was asked for, and the timeline of status
changes and messages ("You" / "Drincup Cafe" to the customer; names to the
admin). By state: **submitted** cancel (free); **quoted** accept & pay,
request changes (a message; `catering_request_changes`), cancel (free);
**confirmed** ask to cancel (`catering_request_cancellation`; only an admin
can then cancel, with a refund).

### Paying (`/catering/[id]/pay`)

Not a hosted Payment Link: the Payment Element and a PaymentIntent, as at
checkout, so the page is on-brand and catering shares the webhook, its
dedupe and amount check, the reconcile fallback and the refund machinery.

- **Who and when.** The page and `startCateringPaymentAction` check, with
  the request clock, that the quote is the current one, unexpired and before
  the payment deadline (`catering.payment_deadline_hours`, 48 before the
  event; `quotePayability`), then ask the database as the customer
  (`catering_payable_quote`: 42501 not yours, DC010 not waiting for payment,
  DC011 not the current quote, DC012 expired, DC013 past the deadline).
- **One PaymentIntent per quote version**, idempotency key
  `catering-<quote>-<attempt>` (a fresh attempt only after a cancelled one),
  the amount the quote's stored total, metadata `type=catering`,
  `catering_request_id`, `catering_quote_id`. Reopening the page or retrying
  after a decline pays the same intent. Superseding or cancelling a quote
  cancels its unpaid intent.
- **Confirmed** by `mark_catering_paid` (webhook or reconcile), under the
  request's row lock: the current, active quote paid at its exact amount →
  quote paid, request confirmed. A replay is `already_confirmed`. A payment
  for a quote replaced or a request cancelled meanwhile (`not_payable`), or
  landing more than an hour after the deadline (`too_late`), is recorded and
  refunded in full. A wrong amount or currency is recorded and flagged for
  the admin, not confirmed.
- **Full payment only** for now; deposits are on the post-launch list.
- **No points:** catering never earns Overflow Rewards
  (`loyalty.catering_earns_points` stays false; nothing earns for it).

### Cancelling and refunds

Before payment the customer or an admin cancels for free (the active quote
is voided). After it, `adminCancelCateringAction` cancels through the
service-role `catering_cancel_for_refund` (admin re-checked under the row
lock, recorded in the history) and then refunds through `refundPayment`
(the same function orders use: a `refunds` row first, idempotency per
attempt, failures kept for a retry): full, a partial amount, or none, chosen
each time (refund policy: `NEEDS_CONFIRMATION`). A refund made in the Stripe
dashboard that covers the whole paid quote cancels a still-confirmed request
(`apply_refund_state`); refunding a stray payment changes nothing else.
Account deletion refunds a confirmed request in full and cancels any unpaid
PaymentIntent first (as for orders), then cancels and anonymises the
request, now including the delivery ZIP and the customer's messages.

### Fulfilling and the prep list

`staff_catering_prep(location, day)` hands staff at that counter the
confirmed (and fulfilled) requests for a Honolulu day with the **paid
quote's lines** (falling back to what was asked for), never prices or email.
The staff panel shows sizes, notes and a **Mark fulfilled** button
(`catering_mark_fulfilled`: admin or staff at the counter, confirmed, from
the event's Honolulu date). The dashboard asks for "today" by the server's
clock (see "The e2e clock").

### Emails

Through the outbox, like orders, each in the transaction that owes it:

| Change | To | Email |
| ------ | -- | ----- |
| request created | customer | received, with the number and what happens next |
| request created | admin | new request |
| quote issued (each version) | customer | quote ready (skipped if replaced before sending) |
| change requested | admin | the customer's message |
| → confirmed | customer | receipt (lines, totals, card) |
| → confirmed | admin | payment received |
| cancellation requested | admin | the customer's reason |
| → cancelled | customer | the reason and what was refunded |
| the event is near | customer | reminder (`catering.reminder_hours_before`, 24; `catering.reminder_enabled`) |

The admin address is `catering.admin_notification_email` (placeholder,
`NEEDS_CONFIRMATION`). Reminders are queued by `enqueue_catering_reminders()`
at the start of every outbox sweep, once per request, so no new schedule is
needed. Templates share the order emails' layout (`src/emails/layout.tsx`)
and each has a plain-text version.

### Settings (all `NEEDS_CONFIRMATION` unless noted)

| Setting | Default | Meaning |
| ------- | ------- | ------- |
| `catering.min_lead_time_hours` | 72 | Form, server and trigger |
| `catering.payment_deadline_hours` | 48 | No payment later than this before the event |
| `catering.quote_valid_days` | 7 | Default quote expiry (capped at the deadline) |
| `catering.delivery_offered` | true | Assumption |
| `catering.delivery_zip_codes` | Oʻahu street ZIPs | Where delivery is offered |
| `catering.delivery_fee_cents` | 2500 | Default fee on a quote |
| `catering.delivery_fee_taxable` | true | GET on the delivery fee |
| `catering.gratuity_taxable` | false | GET on a gratuity (tips are not taxed) |
| `catering.reminder_enabled` / `_hours_before` | true / 24 | The reminder (confirmed defaults) |
| `catering.admin_notification_email` | catering@drincup.test | Admin notifications |
| `catering.refund_policy` | placeholder copy | Shown to customers |

---

## Pop-up events

An event is a `locations` row of type `event`: one day of a pop-up (at most
24 hours, so a night market past midnight is fine; a weekend market is two
rows), with its own prep time, menu (`event_menu_items`), staff roster,
address or map link, and photo.

- **Admin** (`/admin/events`): lists live, upcoming and past; the form saves
  the event, its menu (picked from the menu, with search, in order) and its
  staff in one transaction (`admin_save_event`). **Publish** is a separate
  step (`admin_set_event_published`) and needs a menu; a deferred trigger
  also refuses a published event with no menu at commit, however it was
  written. **Duplicate to another date** (`admin_duplicate_event`) copies
  everything to the same Honolulu wall-clock times on the new date
  (`shiftEventToDate` mirrors it, unit-tested), unpublished, with a slug for
  its date.
- **Customers** see only published events (RLS on `locations` and
  `event_menu_items`; checkout's `loadLocationSnapshot` refuses an
  unpublished one too). `/events` lists live and upcoming ones with the
  window, place, directions (the admin's map link, else Google/Apple Maps)
  and a menu preview; a live one has **Order for pickup here**, which selects
  it through `selectLocation` (offered locations only) and opens its menu.
  Home shows the next three. Past and unpublished events never reach the
  location switcher (`getStorefront` keeps the cafe and published events
  that have not ended).
- Saving or publishing expires the cached catalogue (`updateTag("menu")`),
  so customers see the change on their next page load.

## Seasonal collections and limited-time products

A collection (`/admin/collections`) has a name, slug, description, banner,
accent colour, a Honolulu start and end, and products in order. The menu
and Home banners show the active one (lowest sort order, then the most
recently started, and only if it has something on this location's menu);
`/collections/[slug]` shows its banner and products, and after it ends a
friendly "This collection has ended" with a link to the menu (before it
starts, a 404).

- **Accent colour:** `#RRGGBB` only (a check constraint, and `safeCssColor`
  at render, so nothing else reaches an inline style). It is decoration only
  (the stripe, a circle, the border); the form shows its contrast against
  white and warns below 4.5:1 (`checkAccentColor`, unit-tested against the
  brand's documented ratios).
- **Artwork** must be the cafe's own; the form says so next to the upload,
  and shows a live preview of the banner before saving.
- **Limited-time products:** `products.available_from` / `available_until`.
  Outside the window a product is off the menu everywhere availability is
  checked, through one function (`isProductAvailableAt`): the menu and
  product page (`buildMenu` / `buildProductDetail`), cart re-validation and
  checkout ("This limited-time item is no longer on the menu."), reorder and
  favourites (via `buildProductDetail`), the staff sold-out list, and the
  catering form (on the event date). The catalogue cache holds the columns,
  and the filter runs per request with the request clock, so windows open
  and close on time. The collection form's **Limited time** box sets a
  product's window to the collection's (and clears it when unticked, if it
  still matches); the menu editor (Phase 9) will set windows directly.

## Images

Banners and event photos are uploaded by `uploadImageAction`
(`src/lib/admin/images.ts`): admins only; JPEG, PNG or WebP judged by the
file's bytes; at most 5 MB (the buckets enforce type and size too);
re-encoded with sharp, upright from the EXIF orientation and **without
metadata** (no GPS or camera data), at most 2400 px; stored under a random
name with the admin's own session, so the Storage policies are the real
boundary. Rows store the bucket path; pages render it with `next/image`
(unoptimised for the local stack's 127.0.0.1) and fall back to the
placeholder when there is none. See "Security model" for who can list what.

## The admin dashboard

`/admin` (Phase 9) is meant to let the owner run the cafe without opening
Supabase Studio. Admin only at every layer: the proxy, the layout, every
page (`requireRole(["admin"])`), every Server Action (`currentAdmin()`,
`src/lib/admin/guard.ts`), every route handler (the CSV exports and the
import template), and every database function.

### How admins write

Nothing writes an admin-managed table from the browser, admins included.
Migration `…026` dropped the `*_admin_write` policies **and** revoked
`INSERT/UPDATE/DELETE` on the menu tables, locations, hours, closures,
settings, promos, rewards and rosters from `anon` and `authenticated`
(`profiles.role` too; customers keep their own name, phone and opt-ins).
Every admin change goes Server Action → `admin_*` security-definer function
(`…027` menu, `…028` operations, `…029` reports), which:

1. checks the caller is an admin (`assert_admin()`, 42501 otherwise);
2. validates what the app relies on, with messages written for the admin
   (22023 and `DC0xx` codes; `rpcFailure()` shows them as they are);
3. runs as the admin, so `auth.uid()` reaches the audit trigger.

`supabase/tests/admin.test.sql` calls **every** `admin_*` function (found by
name, so a new one is covered automatically) as a customer and as a barista
and expects 42501; checks none is executable by `anon`; and checks the
internal helpers behind them are not callable from the API at all.

Reads use the admin's own session (RLS lets admins read everything) or a
definer function for aggregates (`admin_list_orders`, `admin_list_users`,
`admin_attention_items`, the reports). The service role is used only where
the existing money paths already need it (refunds, cancel-with-refund,
reconcile).

### The audit log

`admin_audit_log` records every create, update and delete an **admin**
makes on admin-managed tables: who (id, and name at the time), when, which
table and row (key and a readable label), and for each changed column its
`from` and `to`. One shared trigger, `audit_admin_change()`, is attached to
each table with its key columns and any columns never to record.

- **Recorded:** the menu (categories, products, sizes, groups, options,
  product links), locations, hours, closures, sold-out flags, event menus,
  collections, promos, rewards, settings, site content, setup tasks,
  profiles, staff rosters; admin changes to orders, refunds and emails
  (resolving the attention queue, resends); manual points adjustments.
- **Never recorded:** member codes (a bearer credential for the future
  scanner), cached balances, `updated_at` / `updated_by`, checkout
  fingerprints, outbox locks. Payment rows are not audited (and hold no card
  data anyway).
- **Who:** `auth.uid()`, or a service-role function's transaction-local
  `app.audit_actor` / `app.order_status_actor`. Only admins are logged; the
  system (webhook, jobs, seed) and staff have their own histories (order
  status history, the sold-out log, catering history).
- **The menu import** suppresses per-row entries (`app.audit_suppress`) and
  writes one `import` entry with its summary.
- **Append-only:** no client role may write it. Admins read it at
  `/admin/audit` (filter by person, table and Honolulu dates; before → after);
  a setting's history on the Settings page comes from the same rows.

### The settings registry

`src/lib/settings/registry.ts` defines every setting the admin can change:
key, label, help, section, type (money, percent, minutes, hours, days,
seconds, number, boolean, email, text, list), limits, default and whether the
owner still has to confirm it. It turns form input into the stored JSON
(cents; the GET rate as a fraction; whole percentages), says what is wrong in
plain words, and checks rules across two settings (the preselected tip must
be one of the choices; red after amber). The database keeps the same type
and limits per key (`settings.value_type / min_value / max_value`) and
`admin_update_setting()` enforces them; `registry.test.ts` parses the
migration's `registry:start` block and fails if the two disagree. Who may
read a setting (`is_public`; staff read `staff.*`) is unchanged.

New settings that change behaviour: `tax.tips_taxed` (GET on the tip too,
in `calculateOrderTotal`), `orders.order_ahead_while_closed` (a closed cafe
with a known next opening lets customers add to the cart; checkout already
schedules for that opening), `notifications.reply_to_email` (Reply-To on
every customer email). `orders.max_scheduling_days_ahead` is read nowhere,
so it is not in the registry.

### Setup checklist and site content

`/admin/setup` lists everything still running on a placeholder, from data:
registry settings flagged `needsConfirmation`, every `site_content` row, and
the `setup_tasks` rows (real menu, categories, photos, hours, the cafe's
pickup wording, brand colours and fonts, POS, counter hardware). Each shows
its current value and where it is edited; confirming stamps `confirmed_at` /
`confirmed_by` on the row. The home shows "N of M confirmed" until done.

`site_content` holds the About copy, phone, email, Instagram, Facebook, the
logo (a `brand-assets` Storage path), privacy policy, terms and the refund
policy (moved from the `catering.refund_policy` setting). Public read;
`admin_save_content()` validates each kind. `/about`, `/privacy`, `/terms`,
the header and sign-in logo, and the catering pages read it.

### The menu editor: archive, never lose history

- **Archive vs delete.** A product, size, modifier group or option that
  anything refers to (past order lines, by id or inside the modifiers
  snapshot via a GIN index; favourites; event menus; collections; catering
  requests and quotes; reward eligibility) is **archived**: inactive, an
  `archived_at` stamp, hidden from customers by the existing RLS, intact in
  history. Only something never used is deleted (`DC030` otherwise).
  Removing a used size or option inside the editor archives it the same way;
  giving a new size an archived one's name brings it back. Carts live in the
  browser, so they are not "uses": a cart holding a deleted or archived item
  shows it as no longer available either way.
- **Rules the pricing engine needs**, checked in the editor
  (`src/lib/menu-admin/rules.ts`) and again in SQL: a required single-choice
  group has exactly one default (`DC032`); min ≤ max; "Only show when" names
  an option from another group on the same product (`DC031`) and the rules
  never form a loop (`DC036`); an option a rule depends on cannot be removed
  (`DC034`); a group still on products cannot be archived (`DC035`).
- **Prices** change for new carts and orders only; carts re-price with the
  Phase 4 notice; order lines are snapshots.
- **The live preview** is the customer's `ProductCustomizer` in a preview
  mode, fed by `buildProductDetail` over a one-product catalogue built from
  the draft, so it cannot drift from the menu.

### The menu import

`/admin/menu/import`: template and filled-in example (CSV and XLSX), upload,
preview, confirm. Columns and their rules live in
`src/lib/menu-import/format.ts` (README, "Importing the menu").

- **Reading.** Format by the file's bytes, at most 2 MB. CSV is parsed as
  text; XLSX by a small reader on `fflate` that reads cell values only:
  formula cells are reported as formulas, macro-enabled workbooks and
  embedded objects are refused, old `.xls` is refused, and the unzip is
  bounded by declared sizes (fflate inflates into a buffer of that size, so a
  zip bomb cannot balloon). Nothing in a file is ever evaluated.
- **Checking.** Every row: prices as dollars and cents with two decimals
  (`$5`, `5` and `5.5` refused, saying how to write them; an XLSX number cell
  with at most two decimals is fine), sizes as `Name=price` with `*` for the
  default, modifier groups by short name (`ice-level if Iced` sets "Only show
  when"), allergens and dietary tags from the enums, yes/no columns, unique
  slugs, and any text cell starting with `=`, `+`, `-`, `@`, tab or CR refused
  as formula injection.
- **Applying.** Preview changes nothing. Apply re-reads the same file on the
  server (never a plan the browser sends back) and calls
  `admin_import_menu()`: one transaction, all or nothing; matched by slug, so
  re-importing updates; never deletes; archives products missing from the
  file only when that box is ticked; one audit entry with the summary.

### The attention queue

`admin_attention_items()` lists what needs a person; the Home badge counts
it. Each item links to its page and leaves once resolved:

| Item | Resolved by |
| --- | --- |
| A payment that didn't match its order (Phase 4 flag) | **Place** it (recording the promo as `mark_order_paid` would) or **refund and cancel** it, with a note (`admin_resolve_flagged_order`) |
| A catering payment that didn't match | Mark reviewed, with a note |
| A failed refund | Retry (`retryRefund`), or mark handled with a note |
| A failed email | Retry (back in the outbox, sent at once), or dismiss with a note |
| New catering request, change or cancellation request, payment | Opening the request |
| An unpaid order stuck past expiry | **Check with Stripe**: paid → placed through the webhook's own handler; not paid → cancelled as the expiry job would; still processing → noted. "Stuck" = older than `orders.pending_expiry_minutes` and either the expiry job tried and had to leave it (it now stamps `expiry_attempted_at`) or a day has passed |

### Orders, users, promotions, rewards

- **Orders:** search by number, name or email, Honolulu dates, location,
  status and payment state (`admin_list_orders`). The detail shows what the
  ticket and receipt show, payments as brand and last four only, refunds,
  status history with actors, emails and points. Cancel with a full or
  partial refund (`cancel_order_for_refund` + `refundOrder`), refund a
  picked-up order, resend the receipt (a new outbox row; one in flight at a
  time). Items and totals never change after payment.
- **Users:** role changes need the admin's password (the Phase 2
  `verifyPassword`, plus our own 5 attempts per 10 minutes) and go through
  `admin_set_role`: never your own role (`DC050`); it locks every admin row
  and re-checks the caller after the lock, so two admins demoting each other
  at once cannot both succeed (`admin_roles.concurrent.mjs`), and an admin
  always remains (`DC051` is the backstop); demoting to customer clears
  rosters. Password reset by email only; no account deletion from admin
  (post-launch).
- **Promotions:** once a code has been redeemed its code, type, amount and
  cap are locked by trigger (`DC040`, whoever writes); dates, limits, the
  minimum spend and the switch stay editable.
- **Rewards:** tiers in the admin's order (customers now see that order;
  progress still counts by cost), programme settings from the registry,
  totals from the ledger, member lookup by code, email or name, adjustments
  through `admin_adjust_points`.

### Shared building blocks

`src/components/admin/`: `DataTable`, `FormSection` / `AdminField` /
`FormActions` / `AuditTrail`, `ConfirmDialog`, `ActionButton` (runs one
action, with a confirm or a required note), `SortableList` (drag, or Move up
/ Move down for keyboard and touch; saves each move), `InfoTip` (a popover,
so definitions work by tap), `StatusPill`, `ImageUploadField`,
`HonoluluDateTimeField`, `ProductPicker`. Server Actions handed from server
pages to client components are bound with `.bind(null, …)`, never wrapped in
closures.

## Reports

`/admin/reports`, aggregated in SQL (`…029`), never by loading orders into
the browser. Everything is built on `report_order_facts(from, to, location)`:
one row per counted order with its numbers worked out, so the sales report
and the orders export cannot disagree (tested in `admin.test.sql` and
`e2e/reports.spec.ts`). Dates are Honolulu calendar dates; a range is turned
into instants once (`date::timestamp at time zone 'Pacific/Honolulu'`), so
`orders_location_placed_idx` serves it.

**Definitions** (also in the page's info popovers):

- **Which orders count:** paid orders, i.e. every order that reached Placed
  (`placed_at` set), including ones later cancelled or refunded. Unpaid,
  abandoned and unresolved flagged checkouts never count. A $0.00 order paid
  with a reward counts (gross sales, with an equal reward discount).
- **Which day:** the Honolulu date the order was placed.
- **Refunds, by order date.** A refund is subtracted on the day of the order
  it belongs to, whenever it happened. Chosen so that a day always describes
  the same set of orders and the orders export adds up to the report exactly.
  The trade-off: a refund made today changes an earlier day's figures, so an
  accountant closing a period should export it once refunds have settled. The
  refunded amount is the payment's `refunded_cents`, so refunds made in the
  Stripe dashboard count too.
- **Splitting a refund:** across sales, tax and tip in the order's own
  proportions (half-up to the cent; sales takes the remainder), so a full
  refund takes back exactly what the order added. `splitRefund()` in
  `src/lib/reports/definitions.ts` mirrors the SQL with the same examples.
- **Gross sales:** item prices with add-ons, before discounts (the
  subtotal). **Discounts:** the promo and reward parts, separately.
- **Net sales** = gross − promo − reward − the sales part of refunds. Tax and
  tips are not sales.
- **Tax (GET):** charged on those orders, less the tax part of refunds.
- **Tips:** charged, less the tip part of refunds; reported separately.
- **Average order value:** gross − discounts (before refunds, tax and tips),
  per order.
- **Top products / add-ons:** quantities and line totals (before order-level
  discounts) by the name on the order; add-ons count pumps and shots, and
  their revenue follows each option's per-unit or once charging.
- **Peak hours:** paid orders by Honolulu weekday and hour placed.
- **Catering:** separate from orders, by the Honolulu date the request was
  paid (confirmed), from the paid quote; refunds by the same rule.

For every order: net sales + tax + tips = collected − refunded.

**Exports:** one CSV per report, and the accountant's orders export (one row
per order, every breakdown column), generated by route handlers for admins
only, UTF-8 with a byte-order mark (ʻokina and kahakō survive Excel), and
formula-safe: a text cell starting with `=`, `+`, `-`, `@`, tab or CR gets an
apostrophe in front (`src/lib/csv.ts`); numbers the app computed are written
as numbers.

**Charts:** one series each in the brand teal (at least 3:1 on the card in
light and dark), columns capped at 24 px with a 2 px gap, a single-hue
sequential heatmap with a scale legend, hover and keyboard-focus tooltips, and
a table behind every chart.

## The e2e clock

End-to-end tests need "the day of the event" or "after the collection
ends". `appNow()` (`src/lib/clock.ts`) is the request's "now": real time,
except on the e2e test server, where a `dc_test_clock` cookie (an offset in
milliseconds, per browser context) shifts it. It is honoured only when
`E2E_RUN_ID` is set (only Playwright's server has it) **and** the Supabase
URL is local (`testClockAllowed`, unit-tested), so a deployment against a
hosted database cannot use it. The database keeps its own `now()`: every
rule it enforces uses real time; the clock moves only what the server
decides in TypeScript (live events, showing collections and limited-time
products, the staff prep list's day, catering checks before the database is
asked).

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

## The installable app (PWA)

### Manifest, icons and launch screens

`src/app/manifest.ts` serves `/manifest.webmanifest`: "Drincup Cafe" /
"Drincup", `display: standalone`, start URL `/`, theme and background colours
from `BRAND_COLORS`, any and maskable icons, and shortcuts to Menu, Orders and
Rewards. No `orientation` lock: WCAG 1.3.4, and counter tablets are used
sideways. The root layout adds the Apple web-app tags and one
`apple-touch-startup-image` per iPhone and iPad screen
(`src/lib/pwa/splash-screens.ts`; iOS shows a white screen unless size and
media query match exactly).

**One source, one script.** Every brand image is drawn by
`npm run brand:assets` (`scripts/brand-assets.ts`) from `brand/logo.svg` (or
`brand/logo.png`): manifest icons (rounded tile, and maskable with the logo
inside the 80% safe zone), the monochrome notification badge, the shortcut
icons (lucide glyphs on a brand circle), the Apple touch icon, the favicon
(PNG-in-ICO, 16/32/48), the Open Graph and Twitter card (typeset with Baloo 2
and Inter from `@fontsource` through `next/og`), and 21 launch screens. The
logo is trimmed to its drawn area first, so any replacement is centred the
same way. Colours come from `BRAND_COLORS` in `src/lib/brand.ts`, which a unit
test keeps equal to the CSS `--brand-*` tokens. The current mark is an
original placeholder (`NEEDS_CONFIRMATION`).

### The service worker

**Library: Serwist** (`serwist`, `@serwist/turbopack`). It is the maintained
successor to next-pwa and Workbox's Next.js integrations, it is what Next 16's
own PWA guide points to, and its Turbopack integration works without a webpack
plugin: a route handler (`src/app/serwist/[path]/route.ts`) bundles
`src/sw/sw.ts` with esbuild at build time and serves `/serwist/sw.js` with
`Service-Worker-Allowed: /`. Hand-rolling a worker was the alternative;
Serwist's strategies, expiration and precache revisioning are well tested and
small. It is built as a classic script (module workers are not supported
everywhere yet), and `__DRINCUP_VERSION__` (the deployment id, or the build
time) changes on every build, so every deploy is a new worker.

**Caching rules** (`src/lib/pwa/cache-rules.ts`, pure and unit-tested; the
worker routes on `cacheRuleFor()`):

| Requests | Strategy |
| --- | --- |
| `/_next/static/*` (hashed JS, CSS, fonts) | cache first, 250 entries, 30 days |
| `/_next/image` (menu photos), `/icons/*`, same-origin images | cache first, **60 entries, 7 days**, purged on quota errors |
| An allow-list of public pages: `/`, `/menu`, `/menu/[slug]`, `/rewards`, `/events`, `/events/[slug]`, `/collections/[slug]`, `/catering`, `/about`, `/privacy`, `/terms`, `/accessibility` | network first; the last copy is kept for offline (30 pages, 7 days) |
| Every other page | network only; offline → `/offline` |
| `/api`, `/admin`, `/staff`, `/account`, `/orders`, `/checkout`, `/cart`, catering payment, sign-in, `/auth`, anything not GET, Server Actions, React Server Component requests and prefetches, every other origin (Supabase API, Auth, Realtime, Storage; Stripe) | **never touched or stored** |

It is an allow-list: a page added later is never cached until someone adds it
here. Only the offline page and its icon are precached. Serwist's default
precaches every JavaScript chunk in the app (the admin's included), megabytes
a customer's phone never needs; chunks are cached as they are used instead.
Signing out tells the worker to drop the page cache (`CLEAR_PAGES`), since a
kept Home page greets the person signing out. Under `npm run dev` the worker
registers only with `NEXT_PUBLIC_SW_IN_DEV=true`, and then caches nothing
(dev chunks are not content-hashed); it is there for trying push.

**Offline.** `/offline` (`src/lib/pwa/offline-page.ts`) is one self-contained
HTML page, no scripts and no web fonts, with its own strict CSP: "You're
offline. Your cart is saved on this device. Reconnect to place your order."
"Try again" links to the current address. Pages kept for offline show their
last version under a sticky **Offline** banner (`OfflineBanner`, the same
`useOnline()` signal the staff screen uses). Ordering and paying are blocked
while offline: the cart's Checkout reads "Reconnect to check out" and
checkout's Pay is disabled with the reason. The cart itself is local and
stays.

**Updates.** A new deploy's worker installs in the background and waits
(`skipWaiting: false`). `src/lib/pwa/client.ts` notices it (also when another
tab already switched) and shows "A new version is available. Refresh"; only
the tap swaps workers (`SKIP_WAITING`) and reloads. The page asks for a new
worker every 30 minutes, when the tab becomes visible and on route changes
(throttled to a minute). **Checkout** asks on arrival and, while a newer
version is waiting, disables Pay with "We've just updated the app. Refresh to
continue; your cart is saved." (a Server Action from an old build would fail
against the new server). A payment already in flight is never interrupted.

**Install prompt.** `beforeinstallprompt` is caught and held (so Chrome's own
mini-infobar never appears on a first visit). After a successful order the
confirmation page offers "Add Drincup to your home screen": the browser's
dialog on Android and desktop Chrome and Edge, "Tap Share → Add to Home
Screen" steps on iPhone and iPad (no install API there). Hidden when already
installed (`display-mode: standalone` / `navigator.standalone`), when the
browser can't install, and for good once dismissed or installed
(`localStorage`).

**Payments in the installed app.** The Payment Element runs 3-D Secure in a
Stripe frame on our page, not a top-level redirect, and `return_url` is our
own `/orders/[id]/confirmed`, inside the app's scope, so the installed app
stays in its window through payment and confirmation.

---

## Push notifications

"Your order is ready" as standard Web Push (RFC 8030), encrypted to the
device (aes128gcm, RFC 8291) and signed with our own VAPID key (RFC 8292). No
third-party service or account: browsers deliver through their vendors' push
services (Google FCM, Mozilla, Apple, Microsoft WNS), which only see an
encrypted blob.

**Keys.** `npm run push:keys` writes `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` to `.env.local`. Existing keys are
kept: every subscription is bound to the public key, so new keys cut every
device off. Without keys the app simply doesn't offer push.

**Subscribing** (`src/lib/push/client.ts`), only from a button: "Notify me
when it's ready" on the tracker, or Account → Notifications. The tap asks for
notification permission, subscribes this browser's `PushManager` with the
public key, and sends the subscription to `savePushSubscriptionAction`. The
server checks the session, rate-limits (20 per user, 60 per IP an hour),
checks the endpoint is **https on a known push service host**
(`src/lib/push/endpoints.ts`: an endpoint is a URL our server will POST to, so
anything else would be server-side request forgery), labels the device
("Chrome on Android", from the user agent; the user agent itself is not
stored) and calls `save_push_subscription()` (service role only). A browser
has one subscription per site, so a second account on the same browser takes
the row over. Ten devices at most per customer, oldest out. Customers can
read and delete their own rows (RLS), never insert or edit one. Signing out
deletes this device's row in the same request (the sign-out form carries the
endpoint) and unsubscribes it. `pushsubscriptionchange` in the worker
re-subscribes and tells `/api/push/subscriptions` (same-origin, session).

**Sending, through an outbox** like the emails. The trigger
`enqueue_order_push` writes one `push_outbox` row when an order turns Ready
and its customer has any device, in the status change's own transaction
(dedupe key `order_ready:<order>`), so a push can never block or fail a
status change. `processPushOutbox()` (`src/lib/push/outbox.ts`):

1. claims due rows (`claim_push_outbox`, `FOR UPDATE SKIP LOCKED`)
2. skips the row if the order is no longer Ready (a late retry says nothing)
3. reads the customer's devices *now* (a device removed meanwhile gets
   nothing) and leaves out ones already reached (`delivered_to`)
4. re-checks each endpoint against the allow-list, builds the encrypted,
   signed request (`web-push`'s `generateRequestDetails`, TTL 30 minutes,
   urgency high) and sends it with `fetch` (no redirects, 10 s timeout)
5. 2xx: delivered. 404/410: the subscription is gone, deleted. 400/401/403/
   413: refused, deleted after three in a row. 429/5xx/no answer: retried for
   that device only, after 30 s, 2 min, 5 min ("ready" goes stale fast)
6. the row ends `sent` (any device reached), `failed` (a service kept
   failing) or `skipped` (no device could take it)

It runs after the response through `kickOutbox()` (the payment webhook, the
staff cancel route, and `sendOwedNotifications()`, which the staff dashboard
calls right after it moves an order, since that move is a direct database
call); from the scheduled `/api/cron/send-emails` (path unchanged; it now runs
both outboxes); and every 15 s under `npm run dev`.

**The payload** is the order number and pickup location only, with the tag
`order-ready-<order>` and the tracker's URL. The page's own notification uses
the same tag, so a customer watching the tracker gets one notification, not
two. The worker only ever opens a same-site path from a notification.

**Where it works.** Chrome, Edge, Firefox and Samsung Internet on Android and
desktop, in the browser or installed; Safari on macOS 13+. **iPhone and iPad
only once the app is on the Home Screen, on iOS 16.4 or later**: in Safari the
page says so and shows the steps (`needs-install`). Elsewhere the button
falls back to plain page notifications while the tracker is open.

**Tests.** pgTAP (`push_notifications.test.sql`); unit (endpoint allow-list
and SSRF cases, delivery rules, payload safety, and a real encrypt-then-decrypt
of a built request); e2e (`pwa.spec.ts`) against a stand-in push service on
127.0.0.1, which the server accepts only on the Playwright test server against
a local database (the e2e clock's guard): subscribe from the tracker, exactly
one encrypted push on Ready (decrypted and checked), a dead device removed,
Account management, sign-out.

---

## Security headers

`src/lib/security/headers.ts` holds the policy (unit-tested); `src/proxy.ts`
sets the Content Security Policy per request, `next.config.ts` the rest.

**Content Security Policy, nonce-based.** Each request gets 128 random bits
as a nonce, passed to the render in the request's CSP header (Next puts it on
its own scripts) and sent to the browser:

| Directive | Allows | Why |
| --- | --- | --- |
| `script-src` | `'nonce-…' 'strict-dynamic'` (+ `'self'` and Stripe's hosts as a fallback for old browsers) | only our scripts, and what they load (our chunks, Stripe.js); no inline handlers, no `javascript:` URLs, no eval (eval only under `next dev`, which React needs) |
| `style-src` | `'self' 'unsafe-inline'` | server HTML carries `style=""` attributes (React style props, placeholder colours) that a nonce cannot cover; styles cannot run code |
| `connect-src` | `'self'`, Supabase (https and wss), `api.stripe.com`, `merchant-ui-api.stripe.com`, `r.stripe.com`, `fonts.googleapis.com` | our API and Server Actions; Supabase REST, Auth and Realtime; Stripe's API; Stripe.js fetching the card form's font CSS |
| `frame-src` | `js.stripe.com`, `*.js.stripe.com`, `hooks.stripe.com` | the card form, wallet buttons, 3-D Secure |
| `img-src` | `'self' data: blob:`, Supabase, `*.stripe.com` | our images and the optimiser, Storage photos and the logo |
| `font-src` | `'self' data:` | `next/font` self-hosts the fonts |
| `worker-src`, `manifest-src`, `media-src` | `'self'` | the service worker, the manifest |
| `frame-ancestors` | `'none'` | nobody may frame us. Stripe never frames our pages; it is the other way round (`frame-src`) |
| `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | | no plugins, no `<base>` hijack, forms post only to us |
| `upgrade-insecure-requests` | on https sites only | local http and LAN phone testing keep working |

A nonce needs a per-request render. Every page already was dynamic (they read
the session); the root layout now calls `connection()` so Next's built-in 404
page is too (prerendered, it had no nonce and its scripts were blocked; the
e2e guard caught it). The offline page and the worker have their own fixed
policies.

**Other headers, every response:** `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`
(old browsers), `Cross-Origin-Opener-Policy: same-origin-allow-popups`, and in
production builds `Strict-Transport-Security: max-age=63072000;
includeSubDomains` (no `preload` until the domain is final). The
`Permissions-Policy` turns off camera, microphone, geolocation, USB, serial,
HID, MIDI, sensors, display capture, XR and picture-in-picture, and allows
only what we use: `fullscreen` and `screen-wake-lock` (staff screen),
`autoplay`, and `payment` / `publickey-credentials-get` for us and
`js.stripe.com` (Apple Pay, Google Pay, Link). Notifications and vibration are
not Permissions-Policy features at all, so they need no entry; only names
Chromium recognises are listed (an unknown one is a console error on every
page).

**How it is tested.** The e2e page guard fails any test whose pages log a CSP
violation or a Permissions-Policy error, so every flow in the suite (checkout
with Stripe's card form, 3-D Secure, Express Checkout, Realtime, images, the
service worker, push) doubles as a policy test. `e2e/security-headers.spec.ts`
pins the policy itself: a fresh nonce per request on every script tag,
injected markup (an inline handler, a `javascript:` link) blocked, the 404
page's scripts running, and the static headers on pages, assets and the
worker.

---

## Errors and logging

**What people see.** Every route group has an error boundary inside its frame
(customer app, sign-in, staff screen, admin) and the root has a branded
`global-error.tsx`; all use `ErrorPanel`: a friendly sentence, Try again, a
way home, and Next's error digest to quote. Never the error's text: Next
replaces a Server Component's message in production, and Server Actions
return written sentences (`GENERIC_ERROR`, or our own validation messages for
admins), logging the rest. Every route has a skeleton `loading.tsx` and the
customer and admin frames have branded not-found pages.

**Real 404s under skeletons.** A dynamic page always streams, even to
search engines, and once a `loading.tsx` skeleton has gone out the status is
200; a `notFound()` after that shows the not-found page with `noindex` but
cannot change the status. So the customer pages that can be missing or
someone else's (a pop-up, a collection, an order, its confirmation, a
catering request and its payment page) check in a `layout.tsx` of their own
segment, which renders above that segment's skeleton, and the list pages
above them keep their skeletons inside route groups (`(home)`, `events/(list)`,
`orders/(list)`, `orders/[id]/(tracker)`, `account/(profile)`,
`account/catering/(list)`, `catering/(info)`), so no skeleton sits above a
check. The lookups are `cache()`d, so layout and page share one query. A
guest still gets a real redirect to sign in. Product pages keep the soft 404
they have had since Phase 3 (the menu's skeleton sits above them, and
moving it would mean regrouping the menu's modal routes); admin detail
pages likewise (admin-only, never indexed).

**What the server logs** (`src/lib/log.ts`): one JSON line per error with
`event`, `requestId`, `viewer`, `route` and the error's name, message, code
and the top of the stack. The proxy gives each request an id (returned as
`X-Request-Id`) and a viewer label: `guest`, `signed-in`, or the role when
the route needed it, never an id, name or email. `onRequestError` in
`src/instrumentation.ts` writes the same line for anything a page, Server
Action, route handler or the proxy did not handle (path without its query
string, which can hold search terms); a browser that went away mid-response
(a prefetch cancelled by navigating on) is not our error and is skipped. `redact()` masks emails, US phone
numbers, card-like numbers, JWTs, bearer credentials and Stripe/Supabase keys
in every message, stack and context string (a Postgres error can quote the
row it failed on). User ids are no longer written to logs.

---

## Monitoring (proposal, decided in Phase 11)

Nothing is installed yet. What we have today: structured, redacted error
lines in Vercel's runtime logs with request ids; Supabase's own logs and
reports; Stripe's emails about failing webhooks; the admin's Needs-attention
queue for failed emails, refunds and flagged payments.

**Recommended for launch:**

| Need | Tool | Cost (verify at sign-up) |
| --- | --- | --- |
| Errors, browser and server, with alerts | **Sentry**, Developer plan | free up to 5,000 errors a month, one user; Team about $26/month if it outgrows that |
| Uptime: is the site up, can it reach the database | **UptimeRobot** (or Better Stack) checking `/` and a small `/api/health` (to add in Phase 11: one cheap database read), every 5 minutes, alerting by email and SMS | free (paid plans from about $7/month for 1-minute checks) |
| Logs and performance | **Vercel's built-in** runtime logs and Speed Insights; log drains and longer retention need Vercel Pro (about $20/user/month), which the cron schedule may need anyway (Phase 11) | included / Pro |

Sentry would be set up with `sendDefaultPii: false`, no session replay, our
`redact()` in `beforeSend`, the request id as a tag, and source maps uploaded
at build (an auth token in Vercel's build environment). Vercel-only (no
Sentry) is the cheaper alternative: errors stay in the logs we already write,
but nothing alerts anyone and logs age out quickly on Hobby.

**What we need from the cafe:** who gets alerts (email and phone), whose
account owns Sentry and the uptime monitor (best: an address the cafe
controls, with the developer invited), a monthly budget ceiling, and a line
in the privacy policy about error monitoring.

---

## Accessibility

Target WCAG 2.1 AA, checked by `e2e/accessibility.spec.ts`:

- **axe-core** on every main page and state as guest, customer, barista and
  admin, including the product sheet, a form showing its errors, checkout,
  the tracker (in progress and Ready), the staff queue with a ticket and a
  dialog open, and some thirty admin pages; serious or critical fails.
  Stripe's card frames are excluded (Stripe's to answer for).
- **Keyboard only:** menu → product sheet → Add to Cart → cart → checkout →
  Stripe's card fields → Pay → placed; the staff queue's Start shift and
  Accept; an admin content form.
- **Reflow** at 320 px (also 1280 px at 400% zoom), **touch targets** of 44 px
  (56 on the staff screen; a stretched card link counts the card, a
  checkbox counts its label), **skip links** first on every frame,
  **reduced motion** stopping animations, and the **okina and kahakō** drawn
  by Baloo 2 and Inter in every weight used.

Built in: "Skip to content" (`SkipLink`) on every frame; focus moves to the
page after client-side navigation (`RouteFocus`) unless a dialog opened or
focus is already in the page; dialogs and sheets (Radix) trap and return
focus; toasts never take focus. Live regions: the product's price as it
changes, the order status on the tracker, the Ready banner, the staff
screen's new-order alert (it changes only when the count does), cart
validation messages; skeletons announce "Loading…" once. Form errors are tied
to their fields with `aria-describedby` and `aria-invalid`. Every animation
is `motion-safe` and the global reduced-motion rule cuts the rest to nothing.
Fonts preload only `latin` (it carries the okina U+02BB); `latin-ext`, with
the precomposed kahakō vowels, loads the first time a page shows one. The
accessibility statement is site content (`/accessibility`, edited in Admin →
Pages & contact).

Contrast: deep teal on the teal tint was 4.48:1. The tint is now `#f0fafb`
(4.66:1); the interactive teal (`#0e7c86`) is unchanged.

---

## Performance

`npm run lighthouse` (`scripts/lighthouse.mjs`) builds, serves on port 3200
and runs Lighthouse's mobile preset on Home, Menu, a product page, Cart,
Rewards, Events and Catering, three runs each, median per category, failing
below 90. Cart is disallowed in robots.txt on purpose, which "Page is blocked
from indexing" always fails, so that one audit is left out of Cart's SEO
score (printed every run).

Mobile, simulated throttling, median of three runs, against the local
dev database (Phase 9 code before, Phase 10 after):

| Page | Performance | Accessibility | Best practices | SEO | LCP | TBT |
| --- | --- | --- | --- | --- | --- | --- |
| Home | 79 → **91** | 100 → 100 | 100 → 100 | 100 → 100 | 4.0 s → 3.3 s | 300 → 110 ms |
| Menu | 72 → **90** | 100 → 100 | 100 → 100 | 100 → 100 | 5.7 s → 3.5 s | 530 → 120 ms |
| Product | 63 → **90** | 100 → 100 | 100 → 100 | 90 → **100** | 5.7 s → 3.5 s | 510 → 150 ms |
| Cart | 69 → **92** | 100 → 100 | 100 → 100 | 100 → 100* | 5.1 s → 3.1 s | 480 → 80 ms |
| Rewards | 66 → **91** | 100 → 100 | 100 → 100 | 100 → 100 | 5.0 s → 3.3 s | 380 → 110 ms |
| Events | 74 → **93** | 100 → 100 | 100 → 100 | 100 → 100 | 5.0 s → 3.2 s | 460 → 130 ms |
| Catering | 70 → **91** | 100 → 100 | 100 → 100 | 100 → 100 | 5.0 s → 2.6 s | 470 → 110 ms |

* Without "Page is blocked from indexing" (see above). CLS is 0 on every
page. Menu and Product sit right at 90: a single run can land a point or two
either side. Lighthouse's simulation counts every script that finished
before the largest paint against LCP, and on localhost the scripts arrive
before the first paint, so these numbers are, if anything, pessimistic; the
real check is PageSpeed Insights on the deployed site (Phase 11).

What moved it (all first-load JavaScript, which moves LCP and TBT together):

- **Zod out of the browser.** `env.ts` was in every page's bundle (through
  the Supabase browser client) and imported Zod (~90 KB gzipped). Public
  variables are now checked by hand; the secrets moved to the server-only
  `env.server.ts`; the favourite-name check and the auth constants the
  forms show moved to Zod-free modules. Zod's `eval` probe was also a quiet
  CSP violation (Best Practices).
- **supabase-js on first use.** The live-order hooks imported it at module
  load, so guests downloaded ~70 KB they never use.
- **Only what renders.** Next bundles every client component a page imports
  whether it renders or not. The header's location sheet, the cart's edit
  sheet (it carries the whole product customizer) and Home's and the menu's
  signed-in-only parts (favourites, order cards, Order again) are loaded with
  `next/dynamic` from client modules when they are wanted.
- **Toasts on idle.** Sonner loads when the browser is idle or a toast is
  shown; no Radix Tooltip provider (nothing used it).
- **The largest paint, sooner.** Home's skeleton shows the real taglines; the
  cart shows the pickup location and instructions from the server before the
  saved cart is read.
- **Fonts:** only the `latin` files are preloaded (two instead of four).
- **Metadata in `<head>` for everyone** (`htmlLimitedBots: /.*/`): streamed
  metadata went into `<body>` for unknown user agents, and product pages lost
  their description to tools that read the head.
- **No layout shift:** `<main>` is at least a screen tall, so the footer
  never jumps when a page streams in after its skeleton.
- Already in place and kept: product images through `next/image` with
  `sizes` (the product page's photo is `priority`; menu cards lazy-load);
  no chart library (the admin's charts are HTML and CSS); Stripe.js loads
  only on checkout and catering payment; the member QR is a tiny SVG
  encoder; hashed `/_next/static` cached
  for a year by Next, brand images for a week.

**Database.** Reviewed with `pg_stat_statements` and each page's queries:
history (`orders_user_created_idx`), tracker (primary key), rewards activity
(`loyalty_transactions_user_idx`), favourites, the staff queue
(`orders_location_status_idx`), the outboxes (partial due indexes) and the
reports are covered, and no page loads in a loop. Added `refunds_payment_idx`
(refunds are found by payment on every refund, retry and refund webhook).
Foreign keys to `profiles` used only for "changed by" stay unindexed (only
scanned when a profile is deleted). **Realtime:** one channel per filter,
closed when its last component unmounts; `e2e/realtime-cleanup.spec.ts`
watches the websocket's own frames to prove the tracker's channel is left on
every navigation away while the app-wide one stays.

---

## SEO and sharing

Every public page has a title, a description and a canonical URL built on
`NEXT_PUBLIC_SITE_URL`; product pages share their photo. Private pages
(sign-in, account, orders, cart, checkout, staff, admin) are `noindex`.
`/robots.txt` disallows `/admin`, `/staff`, `/account`, `/orders`,
`/checkout`, `/cart`, catering payment, `/api`, sign-in and `/offline`
(`src/lib/seo/robots.ts`); `/sitemap.xml` lists the public pages, every
product, published pop-ups that haven't ended and collections running now,
read per request. Home and About carry `CafeOrCoffeeShop` JSON-LD
(`src/lib/seo/structured-data.ts`): address, weekly opening hours from
`location_hours` (days with equal hours grouped; `24:00` written as `23:59`),
phone, email and social links from site content, the menu and an order
action. The share card is drawn by `npm run brand:assets`.

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

- **Condition cycles:** resolved in Phase 9. The editor and
  `write_product_groups` refuse "Only show when" rules that form a loop
  (`DC036`). A loop written by the service role directly is still possible;
  the engine would then hide those groups.
- **Deleting orders that have items:** `freeze_order_items` blocks deleting
  items of any order past `pending_payment`, cascades included, so a placed
  order cannot be deleted outright. That is deliberate for real data, but the
  seed script's wipe will need `npm run db:reset` instead once real orders
  exist locally.

---

## Post-launch

Agreed for after launch (Decisions Log, Phases 2, 5, 7, 8 and 10). v1 auth is
email + password only, order updates are in-app, by email and by push (no
SMS), points are earned online only, catering is paid in full, and the app is
light only.

### Dark mode

Not low-risk with today's tokens, so not in v1. The semantic tokens
(`--background`, `--card`, `--primary`, ...) have dark values in
`globals.css`, but the components use the raw brand palette directly about
500 times (`bg-brand-teal-deep text-white`, `bg-brand-teal-soft`,
`text-brand-magenta-deep`, the brand wash), and those don't change with the
theme: in dark mode they would be pale tints and deep teal on near-black,
much of it under 4.5:1. Doing it properly: give the brand layer semantic
names (`--surface-tint`, `--accent-strong`, `--on-accent`, ...) with light
and dark values, move components onto them, check every pairing for
contrast (the axe suite would run in both modes), decide dark versions of
the brand art (the wordmark, the placeholder cups, the share card) with the
cafe, and switch on `prefers-color-scheme` with a toggle in Account. The
customer app, staff screen and admin should move together, or a barista
sees two looks. Toasts are pinned to light until then.

### Catering deposits

v1 takes the whole quote at once. A deposit would mean: a deposit amount or
percentage on the quote (a setting for the default), two PaymentIntents per
quote version (deposit at acceptance, balance by the payment deadline, each
with its own idempotency key and `metadata.part`), a `deposit_paid` state
between quoted and confirmed (`is_valid_catering_transition`, the TypeScript
mirror and its parity test), reminder and receipt emails for the balance,
and a rule for what a cancellation refunds of each part (the refund policy
is still `NEEDS_CONFIRMATION`). `mark_catering_paid`'s amount check would
compare against the part being paid.

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

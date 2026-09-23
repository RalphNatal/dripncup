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
| `modifier_groups` | Reusable customisation groups: Milk, Syrups, Sweetness, Ice. `quantity_unit` names one unit ("pump", "shot"); `charge_per_quantity` says whether a delta is charged per unit (extra shots) or once (a flavour at any number of pumps). |
| `modifier_options` | The choices inside a group, each with a `price_delta_cents`. |
| `product_modifier_groups` | Links products to groups, with optional per-product overrides of required/min/max, and `visible_when_option_id` for conditional groups. |
| `location_availability` | Sold-out overrides. **A row exists only when something is unavailable** — no row means available. |
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
| `catering_requests` / `catering_request_items` | Enquiries and their line items. Contact fields and `user_id` are cleared by account deletion (`anonymized_at` set). |
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
   cookie alone therefore cannot delete an account.
2. **Calls `delete_account_data()`** with the service role. In one
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
3. **Signs this browser out, then deletes the auth user** through the admin
   API. That ends every other session, and `profiles` cascades away from
   `auth.users`. If this last call fails, the tombstone keeps the account
   locked out, and the next sign-in attempt with the right password finishes
   the deletion.
4. **Redirects to `/?account=deleted`**, and Home confirms it.

`order_items` are left as they are. They are the immutable snapshot of what
was sold (`freeze_order_items`) and carry no contact details.

Two constraints keep the flow honest. `orders_owner_or_anonymized` means an
order can only lose its owner through this flow, so a checkout bug cannot
write orphaned orders. It also means an auth user who has orders cannot be
deleted from the Supabase dashboard around the anonymising step; the FK's
`SET NULL` fails instead. `catering_owner_and_contact_or_anonymized` does the
same for catering, and the customer insert policy forbids setting
`anonymized_at`.

> **Phase 4 follow-up:** once payments exist, an order cancelled here after
> payment cleared needs a refund. Refund `cancelled` orders that have a
> `succeeded` payment as part of the cancellation flow.

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
                     + Σ modifier delta × (quantity if the group charges
                                           per unit, else 1)
                     never below 0
  line total       = unit price × quantity             (quantity 1–99)

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
never amounts. Phase 4's `calculateOrderTotal` should be, per cart line,
`validateSelection` → `resolveSelection` → `calculateLinePrice`, built from
the same `buildProductDetail` mapping the product page uses
(`src/lib/menu/model.ts`). That mapping is where per-product overrides,
sold-out flags and event menus are applied.

### What checkout re-validates

Menu-page state is not trusted at checkout. Before payment the server
re-verifies: the location is open and not paused, an event is inside its
window, every product and modifier option is still available at that location,
the promo is valid for this user and spend, the reward is affordable, and the
scheduled slot is still within opening hours.

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
(shop)/page.tsx            Home (placeholder)
(shop)/menu/page.tsx       the menu, server-rendered
(shop)/menu/[slug]         full product page: shared links, refreshes
(shop)/menu/@modal/(.)[slug]
                           the same product as a sheet / dialog when opened
                           from the menu (intercepting + parallel routes)
(shop)/rewards, /orders, /cart   placeholders until their phases
```

Closing the sheet calls `router.back()`, so the menu keeps its scroll
position. Focus returns to the card that opened it (`useRouteDialogFocus`),
because Radix would otherwise send focus to a `Dialog.Trigger` this route
does not have.

### Cart (Phase 3 scope)

A Zustand store persisted to `localStorage` (`src/lib/cart/store.ts`). Each
line holds the location id, product and size ids, the pruned modifier
selection, special instructions and quantity, plus a display snapshot: names,
a summary, and the unit price when it was added. The snapshot is only for
display. Checkout re-validates and re-prices every line from the ids.
Identical lines merge (capped at 99). Changing location keeps the cart but
sets `needsRevalidation`; Phase 4's cart page acts on it. The store hydrates
after the first render, so server and client HTML agree.

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

Postgres has matching helpers: `cafe_date(instant)`, `cafe_today()` and
`cafe_clock()`.

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

- **Refunds on cancellation** (Phase 4): see Account deletion above.
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

Agreed for after launch (Decisions Log, Phase 2). v1 auth is email + password
only.

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

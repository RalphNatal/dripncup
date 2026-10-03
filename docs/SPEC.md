# Drincup Cafe — Order-Ahead Web App Spec (Honolulu, Hawaii)

> **Source of truth for every phase.** Read this in full before starting any phase. Decisions made during development are recorded in the **Decisions Log** at the end; where the log and the original spec differ, **the log wins**.
>
> **Status:** Phases 1–6 complete (Foundation; Auth & roles, including account deletion and the timezone test; Menu & customization; Cart & checkout with Stripe test mode; Order tracking, emails, history, reorder & favorites, with the Part 0 staff lock-down; Staff dashboard). Next: Phase 7.

You are a senior full-stack engineer building a production-quality, mobile-first order-ahead web app for **Drincup Cafe**, an independent drink and food cafe at **1221 Kapiolani Blvd, Site 112A, Honolulu, HI 96814**. The experience should rival a major coffee chain's app (browse → customize → pay → pick up → earn rewards) but with Drincup's own warm, community-focused identity. Do not copy any other company's names, colors, logos, icons, copy, or layouts.

Build in phases (listed below). **Stop after each phase** and summarize what you built, which files changed, and anything the developer needs to do manually before continuing.

---

## 1. Brand
- **Name:** Drincup Cafe (one word; the logo wordmark is lowercase "drincup cafe")
- **Taglines:** "Sip, Smile, Repeat." and "Good drinks, food, & community."
- **Story:** The name is inspired by Psalm 23:5–6 and Psalm 34:8, about tasting God's goodness and a cup that overflows. Tone is warm, joyful, and welcoming. About page copy: `NEEDS_CONFIRMATION` (to be supplied from the current website)
- **Colors** (approximate, sampled from the current site; replace with official values when supplied — `NEEDS_CONFIRMATION`): teal `#1AB3C0` (primary), light pink `#F29BB8` and magenta `#E0409B` (accents), black `#000000` (footer/contrast), white. See Decisions Log for accessible variants
- **Typography:** match the current website (`NEEDS_CONFIRMATION`). Fallback: a rounded sans-serif for headings, a clean sans-serif for body
- **Logo:** `NEEDS_CONFIRMATION`
- **Social/contact:** Instagram, Facebook, email, phone — `NEEDS_CONFIRMATION`
- **Loyalty program name:** **"Overflow Rewards"** (suggested; client may rename)

## 2. Tech Stack
- **Framework:** Next.js (latest stable, App Router) + TypeScript (strict mode)
- **Styling/UI:** Tailwind CSS + shadcn/ui, lucide-react icons, Framer Motion for small transitions
- **Backend:** Supabase (Postgres, Auth, Realtime, Storage, Row Level Security)
- **State:** Zustand for the cart (persisted), TanStack Query for server data
- **Validation:** Zod on every form and API input
- **Payments:** Stripe in **test mode** using the Payment Element (cards, Apple Pay, Google Pay). Keep payment logic behind a provider interface so it can be swapped. Whether the cafe uses Square or another POS: `NEEDS_CONFIRMATION`
- **Email:** Resend (or similar) for order confirmations and catering updates
- **Deployment:** Vercel
- **PWA:** installable, with web manifest, app icons, and offline fallback page
- **Dev environment:** Windows + VS Code. All terminal commands must work in PowerShell

## 3. Hawaii Locale & Business Settings
- **Currency:** USD, formatted `$5.75`
- **Timezone:** `Pacific/Honolulu` (HST, UTC−10, no daylight saving) for store hours, pickup slots, events, order numbers, and reports. Never rely on the server's default timezone
- **Tax:** Hawaii General Excise Tax (GET), shown as its own "Tax (GET)" line. Rate configurable in admin (`NEEDS_CONFIRMATION`). Apply it to the post-discount subtotal
- **Tipping:** optional at checkout (No tip / 15% / 18% / 20% / Custom), reported separately. Tips excluded from the taxed amount (assumption — `NEEDS_CONFIRMATION`)
- **Hours:** `NEEDS_CONFIRMATION`. Admin can add one-off closures and holiday hours
- **Hawaiian language:** render ʻokina and kahakō correctly everywhere. Use "Mahalo!" on the order confirmation screen
- **Phone numbers:** US format

## 4. User Roles
1. **Customer:** browses, orders, pays, tracks orders, earns/redeems rewards, submits catering requests
2. **Staff/Barista:** manages the live order queue for their assigned locations (cafe or active pop-up event)
3. **Admin (owner):** manages menu, hours, events, catering, promos, rewards, users, and reports

Guests can browse the menu, events, and catering page but must sign in to check out.

## 5. Customer Features
**Home:** greeting, Overflow Rewards balance, active order card, current seasonal collection banner, "Order again" from recent orders, upcoming pop-up events.

**Location & pickup:** the main cafe plus any active pop-up event (see section 7). Show open/closed status, today's hours, estimated prep time, pickup instructions (`NEEDS_CONFIRMATION`), and a "Get Directions" button that opens Google Maps or Apple Maps.

**Menu:** categories (`NEEDS_CONFIRMATION` — real categories from the "Offerings" page, e.g., Coffee & Espresso, Tropical Refreshers, Tea, Blended, Shave Ice, Seasonal, Food & Snacks). Search, product cards with image, name, and starting price, dietary/allergen tags (dairy, tree nuts including macadamia, gluten, soy), and "Sold out" badges.

**Product customization (the core of the app):**
- Size, each with its own price
- Hot/Iced where applicable
- Milk options with configurable upcharges
- Espresso shots (+/- stepper with min/max)
- Flavors/syrups (multi-select with pump count), sweetness level, ice level
- Toppings and specialty add-ons (e.g., a signature sparkle add-on)
- Special instructions (max 100 characters)
- Live price updates as options change
- Modifier groups are data-driven: each has required/optional, single/multi-select, min/max selections, and a default. **No hardcoded modifiers in UI code**

**Cart:** edit/remove items, quantity stepper, promo code field, and a breakdown of subtotal, discount, tax (GET), tip, and total. The cart is tied to one location (cafe or event).

**Checkout:**
- Pickup: "ASAP" (shows estimated ready time) or a scheduled 15-minute slot within open hours
- Tip selection
- Stripe payment (card, Apple Pay, Google Pay)
- Optional reward redemption
- Confirmation screen with order number, pickup details, and "Mahalo!"

**Order tracking:** real-time status via Supabase Realtime (Placed → Accepted → Preparing → Ready → Picked Up), with a progress indicator and an in-app alert + sound when Ready. Email receipt. SMS only if the customer explicitly opts in.

**Order history & reorder:** past orders with full customization details, one-tap reorder (re-validated against the current menu and prices).

**Favorites:** save a customized drink with a custom name ("My usual") and add it to the cart in one tap.

**Overflow Rewards:**
- Earn points per $1 spent (rate `NEEDS_CONFIRMATION`), credited only when an order is marked Picked Up
- Configurable reward tiers (e.g., free add-on, free drink)
- Points activity log
- Member QR code on the account page (for future in-store scanning)

**Account:** profile, phone number, favorites, notification preferences, marketing opt-in (off by default), privacy policy, terms, and **delete my account**.

## 6. Catering Orders (`/catering`)
- Request form: event date and time, headcount, drink selections from catering-eligible items or "custom signature drink for my event," pickup or delivery (delivery offered — assumption, `NEEDS_CONFIRMATION`), contact info, budget, and notes
- Minimum lead time is configurable (default 72 hours). The date picker blocks anything sooner, and the database enforces it
- Workflow: Submitted → Quoted (admin sets price and sends a Stripe payment link) → Confirmed (paid) → Fulfilled, or Cancelled. Email the customer at each step
- Customers can view their catering requests and statuses in their account

## 7. Pop-Up Events & Seasonal Collections
**Pop-up events:**
- Admin creates event locations with name, address, date/time window, a limited menu subset, and its own prep time
- Events appear on Home and on an Events page ahead of time
- Customers can pre-order for pickup at the event booth, but only during the event window

**Seasonal / limited-time collections:**
- Start and end dates, themed banner, optional accent color override, and automatic show/hide
- All app artwork must be Drincup's own original artwork, with no third-party characters or trademarks in the app's assets

## 8. Staff / Barista Dashboard (`/staff`)
- Location switcher (cafe or active event), limited to the staff member's assigned locations
- Live order queue in Kanban columns: New → Preparing → Ready
- Audio + visual alert on new orders
- Each ticket shows order number, customer cup name, pickup time, and every item with its modifiers in a clear, scannable format (large text, designed for a counter tablet)
- Buttons to advance status or cancel (with a required reason)
- Toggle items/options as sold out per location
- "Pause online orders" toggle for rush periods
- Today's confirmed catering orders as a prep list
- Printable order ticket / cup label view

## 9. Admin Dashboard (`/admin`)
- **Menu:** categories, products (image upload to Supabase Storage), sizes/prices, modifier groups and options, product ↔ modifier linking, allergen tags, catering eligibility, sort order, active/inactive
- **Locations & events:** hours, closures, prep times, event windows and event menus
- **Settings:** GET rate, tip presets, catering lead time, pickup instructions
- **Promotions & rewards:** promo codes (percent/fixed, min spend, usage limits, dates), reward tiers, earn rate
- **Seasonal collections**
- **Catering inbox:** list and calendar views, quoting, status updates
- **Users:** assign roles and staff location assignments
- **Reports:** sales by day/location/event, tips, tax collected, average order value, top products, peak hours, catering revenue, and CSV export

## 10. Data Model (Supabase / Postgres)
Core tables: `profiles`, `locations` (type `cafe` | `event`, with `starts_at`/`ends_at` for events), `location_hours`, `closures`, `staff_locations`, `categories`, `products`, `product_sizes`, `modifier_groups`, `modifier_options`, `product_modifier_groups`, `location_availability` (sold-out overrides), `event_menu_items`, `orders`, `order_items`, `order_status_history`, `payments`, `favorites`, `loyalty_transactions`, `rewards`, `promos`, `promo_redemptions`, `collections`, `collection_products`, `catering_requests`, `catering_request_items`, `settings`, `daily_counters`.

Rules:
- `order_items` stores a **snapshot** of product name, size, selected modifiers (JSONB), and unit price at time of order; snapshots are immutable once payment clears
- Money is stored as integers in cents
- Tax rate and tip amount are stored on each order
- Timestamps are `timestamptz`
- Sensible indexes and foreign keys throughout

## 11. Business Rules (non-negotiable)
- **All prices, discounts, tax, tips, and totals are recalculated on the server.** Never trust client-sent amounts
- Pricing lives in pure functions (`src/lib/pricing/`) with unit tests; `calculateOrderTotal` reuses the same line-price and validation functions the client uses
- Order status transitions are enforced in the database (e.g., cannot go from Placed directly to Picked Up), and the SQL transition table must match `ORDER_TRANSITIONS` in TypeScript (enforced by a test)
- Order creation is idempotent (caller-supplied idempotency key)
- Orders become "Placed" only after the Stripe webhook confirms payment. Verify the webhook signature
- Validate open/paused status, event window, and item availability at checkout, not just on the menu page
- Rewards points are credited on Picked Up and reversed on cancellation/refund; a replayed webhook can't double-credit
- Catering requests cannot be submitted inside the minimum lead time

## 12. Security & Privacy
- RLS enabled on **every** table. Customers see only their own data; staff see only orders for their assigned locations; admin via role check
- Supabase service role key and Stripe secret key used only in server code, never exposed to the client
- Card data never touches our servers (Stripe Payment Element only)
- Route protection in `proxy.ts` for `/staff` and `/admin`, re-checked in every page and server action
- Rate-limit order creation, catering submissions, and auth endpoints
- Privacy policy and terms pages (client to review)
- Marketing emails include an unsubscribe link. SMS requires explicit opt-in and supports STOP
- Working account deletion
- No secrets committed. Provide `.env.example`

## 13. Design Direction
- Mobile-first (design at 390px wide, then scale up to tablet/desktop)
- Customer app uses a bottom tab bar: **Home · Menu · Rewards · Orders · Account**
- Feel: bright, joyful, island-sunny. Teal as the hero color with pink/magenta accents, rounded shapes, and hand-drawn swirl/scribble accents like the current website. Large drink photography and friendly copy
- Customization opens as a bottom sheet on mobile with a sticky "Add to Cart · $X.XX" button
- Skeleton loaders, empty states, and friendly error states everywhere
- Accessibility: WCAG 2.1 AA, keyboard navigable, proper labels and alt text, 44px minimum tap targets
- Light mode required; dark mode nice-to-have

## 14. Seed Data
- The Kapiolani Blvd cafe with sample hours, plus one sample pop-up event (Kakaʻako)
- ~25 menu items with USD pricing and full modifier groups, reflecting a Hawaii cafe (tropical flavors like passion-orange-guava, mango, and coconut alongside espresso classics, shave ice, and snacks). Replace with the real menu when supplied (`NEEDS_CONFIRMATION`)
- 3 reward tiers, 1 seasonal collection, 2 promo codes, 2 sample catering requests
- Test accounts: `admin@drincup.test`, `barista@drincup.test`, `customer@drincup.test` (password in README)

## 15. Build Phases (stop and report after each)
1. ✅ **Foundation:** project setup, Tailwind/shadcn, Supabase client, folder structure, brand design tokens, migrations + RLS, seed script
2. ✅ **Auth & roles:** sign up/in (email + password), profiles, role-based route protection, account deletion, timezone regression test
3. ✅ **Menu & customization:** app shell, location handling, menu, product detail with data-driven modifiers, shared pricing engine, live pricing, minimal cart store
4. ✅ **Cart & checkout:** cart page, promos, tax, tips, pickup slot logic, server-side pricing, Stripe test integration + webhook
5. ✅ **Order tracking & history:** realtime status, emails, history, reorder, favorites
6. ✅ **Staff dashboard:** live queue, alerts, status updates, sold-out and pause toggles
7. **Rewards:** earning, redemption, activity log, member QR
8. **Catering, events & seasonal collections:** customer flows and admin management
9. **Admin dashboard:** remaining CRUD screens, settings, and reports
10. **Polish:** PWA, accessibility pass, loading/empty/error states, performance (Lighthouse 90+ on mobile)
11. **Testing & deploy:** unit + Playwright e2e for the main order flow, Vercel deployment, hosted Supabase auth settings, Apple Pay domain verification in Stripe. Checklist added along the way:
    - **Auth rate limits:** move to Supabase's new API keys, forward each customer's IP with `Sb-Forwarded-For`, and add our own per-IP and per-email sign-in limits with the Postgres limiter (`rate_limit_hit`). No CAPTCHA unless abuse appears
    - **Scheduled jobs:** Vercel Hobby only allows daily crons. Evaluate running the jobs (`/api/cron/expire-orders` every 5 minutes, and the email outbox sender) from Supabase `pg_cron` + `pg_net` calling our routes with the cron secret, versus upgrading to Vercel Pro

## 16. Deliverables
- Clean, typed, commented code with a clear folder structure
- `README.md` with PowerShell setup steps, env var list, Supabase setup, migrations/seed, and local Stripe webhook testing with the Stripe CLI
- `.env.example`
- `ARCHITECTURE.md` explaining the data model, order lifecycle, catering workflow, and pricing logic

## 17. Out of Scope for v1
Third-party delivery, native mobile apps (PWA covers this), gift cards/stored value, POS integration, and multi-language support. Structure the code so these can be added later.

If anything in this spec is ambiguous or conflicts, ask before assuming.

---

## Decisions Log

Decisions made during development. These override the sections above where they differ.

### Phase 1
- **Accessible color variants:** bright teal `#1AB3C0` (2.6:1) and magenta `#E0409B` (3.9:1) fail WCAG AA under white text. Use deepened variants `#0E7C86` (4.95:1) and `#B81C74` (6.1:1) for anything with white text on it; bright hues are for large fills and decoration only
- **Next.js 16:** route protection lives in `proxy.ts` (the old `middleware.ts` convention is deprecated)
- **Extra tables:** `staff_locations` (staff ↔ location assignment) and `daily_counters` (daily numbering)
- **Promos are not customer-readable** so live codes can't be enumerated; codes are validated server-side
- **Staff pause toggle** goes through a definer RPC that updates only that one column; staff have no `UPDATE` on `locations`

### Before Phase 2
- **Order and catering numbers** are generated by column DEFAULTs (`next_order_number()`, `next_catering_number()`), not triggers, so generated types mark them optional on Insert. Formats: `DC-YYMMDD-####` and `CAT-YYMMDD-###`. Empty strings are rejected by a CHECK constraint
- **Numbering uses the Honolulu date** (`cafe_today()`), including the daily counter reset
- **Function access:** `next_daily_number()` and `next_order_number()` are `service_role` only; `next_catering_number()` allows signed-in users; anonymous users can call none of them
- **Customers never insert orders or order items directly.** Orders are created only server-side at checkout
- **Migrations:** once pushed to a hosted Supabase project, never edit an existing migration; always add a new one

### Phase 2
- **Auth is email + password only for v1.** Google/Apple sign-in and email change are deferred to post-launch; keep the auth code structured so they can be added without rework
- **Customers can update only:** name, cup name, phone, opt-ins, and notification preferences. Role changes are admin-only; loyalty points change only through the ledger
- **Sign-up ignores any client-supplied role**; `?next=` redirects are restricted to same-site paths; password reset never reveals whether an email exists
- **Hosted auth settings** (for Phase 11): Site URL, redirect URLs `https://<domain>/**`, minimum password length 8, email confirmation on (see README)
- **Account deletion** (Phase 2 wrap-up): requires password re-entry; cancels unfinished orders and catering requests; keeps past orders and catering records for reports with personal data removed and `user_id` detached; deletes favorites and profile; the last remaining admin cannot delete themselves

### Phase 2 wrap-up
- **Account deletion is one service-role SQL function** (`delete_account_data`) plus the admin API call that removes the auth user. Also scrubbed: order notes, catering notes/custom-drink brief/delivery address, and stored Stripe payloads. Promo redemptions are detached, not deleted; the loyalty ledger is deleted. `order_items` are not touched (immutable snapshot, no contact data)
- **`orders.user_id`, `catering_requests.user_id` and `promo_redemptions.user_id` are nullable**, with an `anonymized_at` marker on orders and catering; check constraints allow a missing owner only once anonymised
- **Numbering functions take `as_of timestamptz default now()`**. Customers may take only today's catering number; an explicit `as_of` is server-only
- **Database tests use pgTAP** in `supabase/tests` (`npm run test:db`); **e2e uses Playwright**, which drives the OS-installed Microsoft Edge on Windows

### Phase 3
- **Conditional modifier groups:** `product_modifier_groups.visible_when_option_id` (per product link, so Ice can be conditional on a latte but always shown on a lemonade). A deferred trigger requires the option to come from another group on the same product. Hidden groups are not validated, charged or stored
- **`modifier_groups.quantity_unit`** ("pump", "shot") and **`charge_per_quantity`** (per unit vs once per option), so per-pump vs per-flavour pricing is a data choice. Seed: syrups charged once per flavour, extra shots per shot (`NEEDS_CONFIRMATION`)
- **Pricing engine API:** `validateSelection(product, groups, selection)`; `resolveSelection(groups, modifiers)` turns ids into catalogue-priced modifiers (the `order_items.modifiers` snapshot shape); `calculateLinePrice(product, size, resolvedModifiers, quantity)`. Prices never come from the client
- **Caching:** the catalogue is cached 60 s (`unstable_cache`, tag `menu`); sold-out flags, hours, closures and the pause toggle are read live (`no-store`). The app stays on Next's previous caching model; Cache Components is a separate decision
- **Selected location** lives in an `httpOnly` cookie (`dc_location`); only a currently offered location can be selected
- **Paused** shows only during open hours; outside them the status reads `Closed · Opens …`. The global `orders.accepting_online_orders` setting pauses every location
- **Images:** only this project's public Storage URLs (or bucket paths) are rendered; anything else falls back to a generated brand placeholder. Collection accent colours must be plain colour values
- **`/cart` is a placeholder** (item count only) so the header icon has a destination; the real cart page is Phase 4
- **Seed tweaks:** an optional "Add milk" group for drip and cold brew (black by default), Ice conditional on Iced wherever both are linked, and one demo sold-out product and option at the cafe

### Phase 4
- **Dev-only product page 500 (Part 0):** a Turbopack on-demand compile failing inside Next's dev route matcher, reproducible only while a file is half-written. Production cold starts are clean; an e2e test opens a product URL first on a cold production server. No app change
- **Orders become Placed only in the payment webhook.** `createCheckout` makes a `pending_payment` order and its snapshot lines through the service-role function `create_checkout_order`, then the PaymentIntent. A return from Stripe's redirect never changes an order
- **Stripe, deferred intent:** the Payment Element and Express Checkout Element render from the quoted total; the PaymentIntent is created when the customer taps Pay. Client secrets are never stored or logged, only sent to the order's owner. Card payments start at Stripe's 50¢ minimum
- **One tap, one order:** the browser sends one idempotency key per set of choices; the server checks a fingerprint of the request against the key and uses `checkout-<key>` as the Stripe idempotency key. A retry after a decline pays the same order. The amount charged is always the amount on the Pay button; if they differ, the customer is asked to tap again
- **Totals:** subtotal → promo → reward (Phase 7 slot) → GET on the post-discount subtotal, rounded once per order → tip → total. Integer maths only, rounding half away from zero. Tip presets are a percentage of the post-discount, pre-tax amount; a custom tip is $0 up to min($100, 100% of the subtotal) (settings `tip.custom_max_cents`, `tip.custom_max_percent`). Tips are not taxed (`NEEDS_CONFIRMATION`)
- **Promos:** one per order, judged only on the server. Every refusal reads "This code can't be applied." except a minimum spend. Failed codes are rate-limited per user and IP. A redemption is recorded, and `times_used` counted, only when the webhook confirms payment. Per-customer limits also count the customer's other unpaid checkouts using the code
- **Pickup times:** ASAP = prep time + `orders.queue_minutes_per_order` (2) × orders in the queue, rounded up to 5 minutes. Scheduled = 15-minute slots, today only (the next open day's when closed now), the last one `orders.last_slot_buffer_minutes` (15) before closing, at most `orders.max_orders_per_slot` (8) per slot; pop-ups only inside their window. Checked on the quote, at order creation and in the webhook (`NEEDS_CONFIRMATION` for the numbers)
- **Closed vs paused:** a closed location can still take a scheduled order for its next open day from a cart built earlier, but the menu still blocks adding while closed (Phase 3). Whether to allow ordering ahead while closed is `NEEDS_CONFIRMATION`. Paused, the global switch off, and a pop-up outside its window block checkout
- **After-the-fact checks in the webhook:** a payment that arrives after the location paused, closed for the chosen time or the event ended is refunded in full and the order cancelled with a reason the customer sees. A payment whose amount or currency does not match the order is recorded but not placed; the order is flagged for admin review and an error logged
- **Unpaid checkouts expire** after `orders.pending_expiry_minutes` (30) via `GET /api/cron/expire-orders` (Vercel Cron, `Authorization: Bearer CRON_SECRET`). The PaymentIntent is cancelled first; anything Stripe says is paid or processing is left for the webhook. `payment_intent.canceled` also cancels a pending order. On Vercel's Hobby plan cron runs at most daily, so decide the schedule at deploy (Phase 11)
- **Refunds:** a `refunds` row is written before every provider call; failures stay `failed` for an admin retry (screen in Phase 9). `PaymentProvider.refund(paymentId, amountCents?, reason)` handles full and partial. Account deletion refunds paid unfinished orders and cancels unpaid PaymentIntents first, and a failed refund does not block it. `cancelOrderWithRefund()` is ready for staff and admin (buttons in Phase 6)
- **Webhook:** raw-body signature check; `webhook_events` dedupes by event id (409 while another delivery is mid-way, so Stripe retries); every handler only moves state forward, so replays and out-of-order events are safe. Handled events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`
- **Rate limiting in Postgres** (`rate_limit_hit`, fixed window), not Upstash: no new vendor, exact across serverless instances, negligible at one cafe's volume; one file to change if that stops being true. `createCheckout` 12 per user / 40 per IP per 10 minutes; failed promo codes 8 per user / 25 per IP per 15 minutes. Fails open
- **Cart:** re-validated on the server on every load and change; price changes applied automatically with a notice; blocking problems must be fixed first; Edit reopens the product sheet and updates the line in place. The cart empties only when its order is confirmed Placed
- **Schema:** migration `20260101000019_checkout_and_payments` adds the `refunds`, `webhook_events` and `rate_limit_hits` tables; review, fingerprint and failure columns on `orders` and `payments`; the service-role functions `create_checkout_order`, `mark_order_paid`, `record_payment_failure`, `apply_refund_state`, `get_promo_for_checkout` and `rate_limit_hit`; and the settings above
- **Phone testing on the LAN:** `npm run dev:lan` binds to 0.0.0.0 and `allowedDevOrigins` allows private-network addresses (README)
- **Auth rate limits (proposed, not built):** Supabase Auth limits sign-ins/sign-ups and token refreshes per IP, and our sign-in and session refresh run on the server, so every customer shares the server's allowance. Proposal: before launch, move to the new API keys and forward the customer's IP with `Sb-Forwarded-For`, and add our own per-IP/per-email sign-in limit with the Postgres limiter

### Phase 5, Part 0
- **Staff change orders only through `advance_order_status(order_id, new_status, reason?)`**, a definer function: the caller must be an admin or staff rostered to the order's location (anyone else, and an unknown order id, get the same 42501); only Accepted, Preparing, Ready, Picked Up and Cancelled are reachable; the move must pass `is_valid_order_transition`; it writes the status, its timestamp and a cancel reason and nothing else. The `orders_update_staff` policy is gone, and `anon`/`authenticated` have no INSERT, UPDATE or DELETE on `orders`, `order_items`, `order_status_history`, `payments` or `refunds` (privileges revoked, not just policies)
- **Paid orders are cancelled only with a refund.** `advance_order_status` refuses to cancel an order holding captured money (SQLSTATE `DC002`); `cancelOrderWithRefund()` cancels through the service-role function `cancel_order_for_refund` (which re-checks the actor and roster under the row lock) and then refunds. A cancel reason is required (3+ characters)
- **Status history records the actor:** `auth.uid()` for the staff function; the staff member for cancel-with-refund (passed through a transaction-local setting); no actor for webhook and expiry changes (the system)
- **Auth rate limits accepted:** the proposal above (`Sb-Forwarded-For` plus our own per-IP and per-email sign-in limits on the Postgres limiter; no CAPTCHA unless abuse appears) is built in Phase 11 and on its checklist
- **Expiry cron:** Vercel Hobby allows daily crons only. Phase 11 evaluates a 5-minute schedule from Supabase `pg_cron` calling our secured route versus Vercel Pro (on the Phase 11 checklist)

### Phase 5
- **Tracker** at `/orders/[id]`, owner only (404 for anyone else, staff included); an unpaid order redirects to its confirmation page, which links to the tracker once Placed. Payment method shown as brand + last four (+ wallet), copied from the Stripe charge into `payments.method_brand/last4/wallet` by the webhook (best effort; the order is placed regardless)
- **Realtime design:** `postgres_changes` on `orders` filtered by `id` (tracker) or `user_id` (Home cards and the Orders tab dot), one shared channel per filter, joined with the customer's token. Events only trigger a refetch through RLS. Refetch also on (re)join, on Realtime's "Postgres listener ready" system message, on tab visible and on reconnecting to the network; poll every 15 s while not joined
- **Ready alert:** banner, synthesised chime only after the customer has interacted with the page (mute remembered in `localStorage`), vibration, tab title while Ready, and a browser notification if allowed through an in-page button (never asked on load). On Android Chrome page notifications need a service worker, so they arrive with the PWA (Phase 10)
- **History:** `list_my_orders()` (definer, `auth.uid()` filter), keyset pagination on `(created_at, id)`, 10 per page. Past = picked up, cancelled or refunded orders that were paid for; abandoned checkouts are not listed. Dates in Honolulu time
- **Reorder and favourites share one check** (`reviewSavedLine`): the snapshot's product, size and option ids are re-validated and re-priced against the live menu at the **selected** location. An unavailable option skips the whole line (never silently swapped for another). Price changes are shown; snapshot prices are never reused. A different original location is noted, with a switch button only if it is still offered. A non-empty cart asks "Add to my cart" or "Replace my cart". Adding respects the location's ordering state, like the menu
- **Favourites:** saved as the order-line snapshot shape; names 1–40 characters, unique per customer ignoring case; 50 per customer, enforced by trigger (`DC003`) and explained in the UI. Saved with quantity 1. A favourite whose drink is sold out today can still be saved; it just can't be added until it is back
- **Emails use an outbox:** a trigger on `orders` writes `email_outbox` rows in the status change's transaction (receipt on Placed; cancellation on a cancel after money was taken; refund on picked-up → refunded; ready only when opted in). `dedupe_key` per order and kind. Sent after the response from the webhook and staff cancel, by `GET /api/cron/send-emails`, and every 15 s under `npm run dev`. Retries after 1, 5, 15, 60, 240 minutes, then `failed`. Recipient and content are read at send time, so a deleted account gets nothing
- **Providers:** Resend when `RESEND_API_KEY` is set (fetch, outbox id as idempotency key); otherwise Mailpit's HTTP send API at `MAILPIT_URL` (default `http://127.0.0.1:54324`). Templates use `react-email` (the `@react-email/components` packages are deprecated). The "Ready" email preference now defaults to off for everyone
- **Cancel with refund for staff:** `POST /api/staff/orders/:id/cancel` (session, same-origin JSON, staff/admin, re-checked in SQL), ready for the Phase 6 dashboard
- **Labels:** the tax line reads "Tax (GET 4.712%)" everywhere (checkout, receipts, emails)
- **SMS:** not built; the opt-in preference stays. Added to the post-launch list in ARCHITECTURE.md

### Phase 6
- **Columns:** Upcoming (scheduled, not yet due) · New (Placed) · In progress (Accepted and Preparing, with a badge) · Ready, replacing the three columns in section 8. A scheduled order is due at pickup time − the location's prep time; it then moves to New and alerts. Within a column: pickup time, ASAP orders by placed time. Columns become tabs below 1024 px
- **Undo window (client only):** Ready and Picked up are held five seconds with Undo and sent only when the time runs out; Accept and Start are sent at once. Closing the tab inside the window drops the action. Database transition rules are unchanged
- **Repeats are no-ops:** `advance_order_status()` returns the order untouched when asked for the status it already has (no error, no history row, no email). The dashboard re-reads the status first and shows "Already updated" if it moved; a move that has become impossible is still refused (`23514`) and shown the same way
- **Ticket lateness:** amber and red at `staff.ticket_warning_minutes` (5) and `staff.ticket_late_minutes` (10) past the estimated ready time (scheduled time, or the ASAP estimate from checkout), with a text label as well as colour. Selections are listed in build order (temperature, milk, shots, flavours, sweetness, ice, toppings, then the rest), by modifier group slug or name
- **Alerts:** chime on arrival, repeated every `staff.new_order_repeat_seconds` (15) until the order is opened, acknowledged or accepted; acknowledgements, volume, mute and the fullscreen choice are per device (`localStorage`). Sound starts only after **Start shift**, which also requests a Screen Wake Lock (re-requested when the tab is visible again)
- **Sold out:** only through `set_sold_out()`; clients lost write access to `location_availability`. "Until end of day" (default) resets at the start of the next trading day: the first opening on a later Honolulu date, closures and holiday hours applied; pop-ups at the next Honolulu midnight. Stored as `available_from`, which readers already honour, so no job runs. Every change is logged with its actor in `location_availability_log`
- **Pause with auto-resume:** `set_location_accepting_orders(location, accepting, resume_at?)` (15/30/60 minutes or until resumed, at most 12 hours) adds `locations.paused_until/paused_at/paused_by`. Auto-resume is lazy: `isAcceptingOrders()` treats a pause past `paused_until` as over in the storefront, checkout and the payment webhook
- **Catering location:** `catering_requests.location_id` (defaults to the cafe by trigger; existing rows backfilled). Staff read the prep list only through `staff_catering_prep()` (confirmed, today, their counter, no money or email)
- **Ticket history and refund amount** come from `staff_order_activity()` (staff cannot read profiles or payments)
- **Counter choice:** `?location=` deep link, else the `dc_staff_location` cookie, else the first offered; offered = the cafe plus pop-ups whose window touches today. Admins can open any location
- **Printing:** in-page print view with an `@page` rule per print: cup labels one per drink at `staff.label_width_mm` × `staff.label_height_mm` (57 × 32 mm), tickets at `staff.receipt_width_mm` (80 mm) with zero margins. Silent printing needs Chrome `--kiosk --kiosk-printing` (README); one printer per Chrome window
- **Summary strip:** orders placed today, average minutes from entering New (placed, or due for scheduled orders) to Ready, and how many are in New or In progress. No revenue
- **Offline:** banner while offline or after Realtime drops; writes fail with a message and are never queued
- **Security fixes:** `can_access_location()` now requires the caller to still be staff (a demoted barista's leftover roster row granted access), and `auth_role()` ignores deleted profiles; `get_setting()` (definer, reads every setting) is no longer callable by `anon`/`authenticated`. The `settings` policy lets staff read `staff.*` keys
- **Schema:** migration `20260101000022_staff_dashboard`. Tests: `supabase/tests/staff_dashboard.test.sql`, `src/lib/staff/*.test.ts`, `e2e/staff.spec.ts` (new Playwright `tablet` project)

### Pending client confirmation
Real menu and prices, categories, trading hours, pickup instructions, logo files, official brand colors and fonts, About copy, social/contact links, GET rate, whether tips are taxed, whether catering delivery is offered, rewards earn rate, which POS the cafe uses, product photography, the checkout timings (30-minute unpaid expiry, 2 minutes per queued order, 8 orders per slot, last slot 15 minutes before closing, $100 custom tip cap), the counter hardware (tablet model, receipt and label printers, label stock size; seeded 80 mm and 57 × 32 mm) and the ticket lateness thresholds (5 and 10 minutes).

Open questions for the owner:
- **Allow ordering ahead while closed?** Today a cart built earlier can be scheduled for the next open day at checkout, but the menu blocks adding while closed
- **Flavors charged per pump or once?** Seeded as once per flavour, any number of pumps (`modifier_groups.charge_per_quantity`)

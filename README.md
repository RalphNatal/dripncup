# Drincup Cafe — Order Ahead

Mobile-first order-ahead web app for **Drincup Cafe**, 1221 Kapiolani Blvd, Site 112A, Honolulu, HI 96814.

Browse the menu → customise your drink → pay → pick it up → earn Overflow Rewards.

> **Sip, Smile, Repeat.** · Good drinks, food, & community.

---

## Stack

| Layer      | Choice |
| ---------- | ------ |
| Framework  | Next.js 16 (App Router) + TypeScript strict |
| Styling    | Tailwind CSS v4 + shadcn/ui, lucide-react, Framer Motion |
| Backend    | Supabase — Postgres 17, Auth, Realtime, Storage, RLS |
| State      | Zustand (cart, persisted) + TanStack Query (server data) |
| Validation | Zod on every form and API input |
| Payments   | Stripe Payment Element, test mode (Phase 4) |
| Email      | Resend (Phase 5) |
| Hosting    | Vercel |

---

## Prerequisites

| Tool | Version | Notes |
| ---- | ------- | ----- |
| Node.js | 20+ (24 recommended) | `node --version` |
| npm | 10+ | ships with Node |
| **Docker Desktop** | latest | **required** — the local Supabase stack runs in containers |

> Install Docker Desktop from <https://www.docker.com/products/docker-desktop/>,
> start it, and make sure the whale icon says "Engine running" before
> continuing.

---

## Setup (PowerShell)

All commands are run from the repository root.

```powershell
# 1. Install dependencies
npm install

# 2. Start the local Supabase stack (first run pulls several images — give it a few minutes)
npm run db:start
```

`db:start` prints a block like this. Keep it — you need two of these values:

```
         API URL: http://127.0.0.1:54321
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
        anon key: eyJhbGciOi...
service_role key: eyJhbGciOi...
```

```powershell
# 3. Create your local env file
Copy-Item .env.example .env.local

# 4. Open it and paste in the two keys printed above
code .env.local
```

`.env.local` needs at minimum:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from db:start>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from db:start>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

```powershell
# 5. Apply migrations and load the demo menu
npm run db:reset    # drops, recreates, and runs every migration in order
npm run db:seed     # locations, ~26 products, modifiers, rewards, promos, test users

# 6. Regenerate database types from the live schema
npm run db:types

# 7. Run the app
npm run dev
```

Open <http://localhost:3000>. Supabase Studio is at <http://127.0.0.1:54323>.

---

## Environment variables

| Variable | Scope | Required | Purpose |
| -------- | ----- | -------- | ------- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | yes | Supabase API endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | yes | Client key; every query it makes is subject to RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | yes | Bypasses RLS. Server-only, never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | public | yes | Absolute URLs in metadata, emails, auth redirects |
| `STRIPE_SECRET_KEY` | **secret** | Phase 4 | Stripe test-mode secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | Phase 4 | Payment Element |
| `STRIPE_WEBHOOK_SECRET` | **secret** | Phase 4 | Verifies webhook signatures |
| `CRON_SECRET` | **secret** | Phase 4 | Guards `/api/cron/expire-orders` and `/api/cron/send-emails` (Vercel Cron sends it) |
| `RESEND_API_KEY` | **secret** | production | Set → emails go through Resend. Leave empty locally: emails go to Mailpit |
| `EMAIL_FROM` | config | production | Sender, e.g. `Drincup Cafe <orders@your-domain>`; the domain must be verified in Resend |
| `MAILPIT_URL` | config | no | Local Mailpit address; defaults to `http://127.0.0.1:54324` |

`.env*` is gitignored. Never commit real keys — `.env.example` is the template.

`src/lib/env.ts` validates all of these with Zod at startup, so a missing variable fails immediately with a readable message instead of a confusing runtime error later.

---

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Next dev server (Turbopack) |
| `npm run dev:lan` | The same, reachable from a phone on your Wi-Fi (see "Testing on a phone") |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:db` | pgTAP database tests in `supabase/tests` (local stack must be running) |
| `npm run test:e2e` | Playwright end-to-end tests (builds the app, serves it on port 3100) |
| `npm run db:start` / `db:stop` | Start / stop the local Supabase stack |
| `npm run db:reset` | Recreate the database and re-run every migration |
| `npm run db:push` | Apply migrations to the **linked remote** project |
| `npm run db:diff` | Diff local schema against migrations |
| `npm run db:types` | Regenerate `src/types/database.ts` from the live schema |
| `npm run db:seed` | Load demo data and test accounts |

---

## Test accounts

Created by `npm run db:seed`. Password for all three: **`DrincupTest123!`**

| Role | Email | Can reach |
| ---- | ----- | --------- |
| Admin | `admin@drincup.test` | `/admin`, `/staff`, everything |
| Staff | `barista@drincup.test` | `/staff` for the cafe and the seeded pop-up |
| Customer | `customer@drincup.test` | ordering, rewards, catering |

---

## Database

Migrations live in `supabase/migrations/` and run in filename order.

```powershell
npm run db:reset          # local: wipe + re-run everything
npm run db:types          # ALWAYS re-run after a schema change
```

To create a new migration:

```powershell
npx supabase migration new add_something
# edit the generated file, then:
npm run db:reset
npm run db:types
```

**RLS is enabled on every table.** Customers see only their own rows, staff see
only orders for locations they are rostered to, and admins are checked by role.
The `promos`, `payments` and `daily_counters` tables are not client-readable at
all. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full policy map.

### Deploying the schema to a hosted project

```powershell
npx supabase link --project-ref <your-project-ref>
npm run db:push
```

Once pushed, never edit an existing migration again: add a new one (see
`CLAUDE.md`).

`supabase/config.toml` only configures the **local** stack. On the hosted
project, set these by hand in the dashboard under **Authentication**:

| Setting | Value |
| ------- | ----- |
| Site URL | `https://<your-domain>` |
| Redirect URLs | `https://<your-domain>/**` (plus Vercel preview URLs if wanted) |
| Minimum password length | `8`, to match the app's form validation |
| Confirm email | **On** — sign-up then shows "check your email" |

### Local email

Locally, no email leaves your machine. Open **Mailpit** at
<http://127.0.0.1:54324> (part of `npm run db:start`) to read:

- **Auth emails** (confirmation, password reset): click the links from there.
  The local stack allows only two auth emails per hour (`[auth.rate_limit]`
  in `config.toml`).
- **Order emails** (Phase 5): the receipt when an order is Placed, the
  cancellation / refund email, and the opt-in "ready" email. With
  `RESEND_API_KEY` empty, the app sends them to Mailpit through its HTTP API,
  so no account or SMTP setup is needed.

**How order emails are sent.** A status change writes the email it owes into
the `email_outbox` table in the same transaction (a database trigger). The
outbox sender (`src/lib/email/outbox.ts`) delivers due rows afterwards:

- right after the response, from the Stripe webhook and the staff cancel
  endpoint, so a receipt lands within a second or two of payment
- every 15 seconds while `npm run dev` is running (`src/instrumentation.ts`),
  so emails owed by a change you make in Supabase Studio go out too. A
  production build (`npm start`) does not run this sweep
- on demand: `GET /api/cron/send-emails` with the cron secret:

  ```powershell
  curl.exe -H "Authorization: Bearer $env:CRON_SECRET" http://localhost:3000/api/cron/send-emails
  ```

A failed send is retried after 1, 5, 15, 60 and 240 minutes, then left as
`failed` (Studio → `email_outbox`; the admin screen is Phase 9). Replayed
webhooks never send a second receipt.

---

## Tests

```powershell
npm test            # unit tests: pure logic, no database
npm run test:db     # pgTAP: SQL functions, triggers, constraints, grants
npm run test:e2e    # Playwright: the app in a real browser
```

`test:db` and `test:e2e` need the local stack running and seeded (`npm run
db:start`, `npm run db:reset`, `npm run db:seed`).

- **Database tests** run each file in `supabase/tests` inside a transaction
  that is rolled back, so they leave nothing behind. `scripts/test-db.mjs`
  pipes them into the running database container, rather than using
  `supabase test db`, because Docker Desktop on Windows intermittently fails
  the bind mount that command needs.
- **End-to-end tests** build the app and serve it on port 3100, so they never
  clash with `npm run dev`. On Windows they drive the Microsoft Edge that ships
  with the OS, so nothing needs downloading. Elsewhere, run
  `npx playwright install chromium` once. `PLAYWRIGHT_CHANNEL` overrides the
  browser (`chromium`, `chrome` or `msedge`). The tests change real rows (the
  pause toggle, sold-out flags, opening hours) and put them back afterwards,
  so they run one at a time. Avoid running them against a database you are
  using by hand.
- **Checkout tests** (`e2e/checkout.spec.ts`, `e2e/webhooks.spec.ts`) pay
  with Stripe test cards in the sandbox, so they need the three Stripe test
  keys in `.env.local` (they refuse a live key). They do **not** need
  `stripe listen`: the test server on 3100 is not where the CLI forwards, so
  the tests fetch the real events from Stripe's Events API (or build signed
  fixtures around real PaymentIntents) and deliver them to the webhook
  themselves. If `stripe listen` is also forwarding to your dev server on the
  same database, that is harmless: every event is handled idempotently.
- **Tracking tests** (`e2e/tracking.spec.ts`) move orders along as the
  seeded barista (a real signed-in Supabase client calling
  `advance_order_status`), listen on real Realtime sockets, and read the
  receipt and cancellation emails from Mailpit, so the local stack must be
  running with Mailpit (it is by default).

---

## Payments (Stripe)

Checkout takes cards, Apple Pay / Google Pay (where the browser offers them)
and whatever else is switched on in the Stripe dashboard, through Stripe's
Payment Element and Express Checkout Element. Card details go straight from
the browser to Stripe; the app never sees them. How an order moves from
"Pay" to **Placed** is in [ARCHITECTURE.md](ARCHITECTURE.md#checkout-and-payments).

### Setup

1. In the Stripe dashboard, switch to the **drincup sandbox** and copy its
   test keys (Developers → API keys) into `.env.local`:
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_…`) and `STRIPE_SECRET_KEY`
   (`sk_test_…`).
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli).
3. In a second PowerShell window, forward webhooks to the dev server. Pass the
   sandbox's secret key with `--api-key`, so the CLI listens to the same
   account the payments are made in (a plain `stripe login` can point at a
   different account):

   ```powershell
   stripe listen --api-key <STRIPE_SECRET_KEY> --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,charge.refunded --forward-to localhost:3000/api/webhooks/stripe
   ```

4. It prints a signing secret (`whsec_…`). Put it in `.env.local` as
   `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`. The secret stays the
   same between runs for the same account and machine.

**Orders only become Placed when the webhook arrives.** Without the listener,
checkout still takes the money but the confirmation page stays on
"Confirming your payment…".

The `--events` list is exactly what the app handles; update it if
`src/lib/payments/stripe.ts` learns a new event. In production, create a
webhook endpoint in the dashboard for `https://<domain>/api/webhooks/stripe`
with the same four events, and use its signing secret.

### Test cards

Any future expiry date, any CVC, any ZIP.

| Card | Result |
| ---- | ------ |
| `4242 4242 4242 4242` | Succeeds |
| `4000 0025 0000 3155` | Asks for 3-D Secure; choose **Complete** (or **Fail**) |
| `4000 0000 0000 0002` | Declined ("Your card was declined") |
| `4000 0000 0000 9995` | Declined, insufficient funds |

More at [docs.stripe.com/testing](https://docs.stripe.com/testing).

### Trying it by hand

With `npm run dev` and `stripe listen` running:

1. Sign in as `customer@drincup.test`, add a Latte, open the cart, press
   **Checkout**.
2. Pay with `4242…`. You land on "Confirming your payment…", then **Mahalo!**
   with the order number once the webhook arrives (watch the `stripe listen`
   window for `[200] POST /api/webhooks/stripe`). The cart empties.
3. Again with `4000 0000 0000 0002`: the decline shows on the checkout page;
   pay again with `4242…` and it completes the **same** order.
4. Again with `4000 0025 0000 3155`: complete the 3-D Secure test page.
5. Promo codes: `MAHALO10` (10% off $10+), `ALOHA5` ($5 off $25+, so it
   explains the minimum spend), `SPRING24` (expired: "This code can't be
   applied.").
6. Refund from the Stripe dashboard (Payments → the payment → Refund): the
   order turns Refunded once `charge.refunded` arrives.
7. Pause the location (until the staff toggle arrives in Phase 6: set
   `locations.accepting_orders` to false in Supabase Studio,
   http://127.0.0.1:54323) and try to pay: checkout refuses. A payment already
   in flight when you pause is refunded automatically, and the confirmation
   page says why.

### Scheduled jobs

`GET /api/cron/expire-orders` cancels checkouts nobody paid for (default: after
30 minutes, setting `orders.pending_expiry_minutes`). It cancels the
PaymentIntent first, so an abandoned checkout can never be charged later, and
leaves alone anything Stripe says is paid or processing. It answers only with
`Authorization: Bearer <CRON_SECRET>`.

On Vercel, set `CRON_SECRET` in the project's environment variables and add a
`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/expire-orders", "schedule": "*/10 * * * *" },
    { "path": "/api/cron/send-emails", "schedule": "*/5 * * * *" }
  ]
}
```

`/api/cron/send-emails` only matters for retries: emails are normally sent
straight after the webhook or staff action that owes them. Which scheduler
runs these every few minutes (Supabase `pg_cron` or Vercel Pro) is decided in
Phase 11.

Vercel sends the secret itself. **The Hobby plan only allows daily cron
jobs** (a 10-minute schedule fails the deploy), so on Hobby either use a daily
schedule or call the route from an outside scheduler with the header. Nothing
breaks while it waits: unpaid orders stop holding pickup slots once they are
older than the expiry window, and a late payment is still handled by the
webhook. Locally, call it by hand:

```powershell
curl.exe -H "Authorization: Bearer $env:CRON_SECRET" http://localhost:3000/api/cron/expire-orders
```

---

## Order tracking (trying it by hand)

Watch an order move without reloading:

1. `npm run dev` (and `stripe listen …` from "Payments" if you pay through
   checkout), sign in as `customer@drincup.test` and place an order. On the
   confirmation page, tap **Track your order** (`/orders/<id>`). Tap the page
   once so the browser allows the Ready sound, and optionally **Notify me when
   it's ready**.
2. Move it along as the barista. Either:
   - **Supabase Studio** → SQL editor (<http://127.0.0.1:54323>), signed in as
     the barista so the real staff function and its checks run:

     ```sql
     -- the order id is in the tracker's URL
     begin;
     select set_config('request.jwt.claims',
       json_build_object('role', 'authenticated', 'sub',
         (select id from profiles where email = 'barista@drincup.test'))::text, true);
     set local role authenticated;
     select status from advance_order_status('<order id>', 'accepted');
     commit;
     ```

     Run it again with `'preparing'`, `'ready'` and `'picked_up'` (one step
     at a time; skipping a step is refused).
   - or **Table editor** → `orders` → change `status` on the row (as the
     postgres superuser this skips the staff checks, but the transition rules
     still apply and the tracker updates the same way).
3. The tracker, the Home card and the dot on **Orders** change within a
   second. At **ready** you get the banner, the chime, a vibration on phones,
   the tab title "🎉 Ready!", and a notification if you allowed them.
4. To see a cancellation with refund on a paid (Stripe) order, as the barista
   in the browser console of a signed-in barista tab:

   ```js
   await fetch("/api/staff/orders/<order id>/cancel", {
     method: "POST", headers: { "content-type": "application/json" },
     body: JSON.stringify({ reason: "Out of oat milk" }),
   }).then((r) => r.json());
   ```

   The customer's tracker shows **Refunded** with the reason, and the
   cancellation email appears in Mailpit.

Turn off Wi-Fi briefly (or block the websocket in DevTools) to see the
fallback: the tracker says "Reconnecting…", checks every 15 seconds, and
catches up as soon as it reconnects or the tab is shown again.

---

## Testing on a phone

To try checkout on a real phone on the same Wi-Fi as your PC:

1. Find the PC's address: `ipconfig` → the Wi-Fi adapter's **IPv4 Address**,
   e.g. `192.168.1.23`.
2. The phone's browser talks to Supabase directly, so it needs the PC's
   address too. In `.env.local`, set
   `NEXT_PUBLIC_SUPABASE_URL=http://192.168.1.23:54321` and
   `NEXT_PUBLIC_SITE_URL=http://192.168.1.23:3000` (put them back to
   `127.0.0.1` / `localhost` afterwards, or the e2e tests refuse to run).
3. Allow the two ports through Windows Firewall, once, from an **admin**
   PowerShell (private networks only):

   ```powershell
   New-NetFirewallRule -DisplayName "Drincup dev (Next)" -Direction Inbound -Protocol TCP -LocalPort 3000 -Profile Private -Action Allow
   New-NetFirewallRule -DisplayName "Drincup dev (Supabase)" -Direction Inbound -Protocol TCP -LocalPort 54321 -Profile Private -Action Allow
   ```

   Make sure Windows calls your Wi-Fi a **Private** network (Settings →
   Network & internet → Wi-Fi → your network).
4. Run `npm run dev:lan` (plus `stripe listen` as above) and open
   `http://192.168.1.23:3000` on the phone.

Private-network addresses are already allowed in `next.config.ts`
(`allowedDevOrigins`). Over plain HTTP, Stripe's card form works in test mode,
but Apple Pay and Google Pay stay hidden: wallets need HTTPS. To test those,
use a tunnel with HTTPS (for example `ngrok http 3000`) and add its hostname to
`allowedDevOrigins`.

---

## Project layout

```
src/
  app/                 App Router pages, layouts, route handlers
    (auth)/            Sign-in, sign-up, forgot-password (shared layout)
    (shop)/            Customer app: header, bottom tab bar, pickup location
      page.tsx         Home: active-order cards, favourites, order again
      menu/            Menu, /menu/[slug] full page, @modal/(.)[slug] sheet
      account/         Profile, preferences, favourites, password, delete account
      cart/ checkout/  Cart (re-validated on the server) and checkout
      orders/          History (active + past), /orders/[id] live tracker
      orders/[id]/confirmed/  Confirmation, after Stripe's redirect
      rewards/         Placeholder until Phase 7
    api/webhooks/stripe/     Stripe webhook (raw body, signature checked)
    api/cron/expire-orders/  Cancels unpaid checkouts (Vercel Cron)
    api/cron/send-emails/    Delivers due emails from the outbox
    api/staff/orders/[id]/cancel/  Cancel-with-refund for staff (Phase 6 UI)
    auth/callback/     Landing route for emailed confirmation / reset links
    staff/ admin/      Dashboards (own plain frame, no customer tab bar)
  components/
    account/           Profile form, delete-account form
    auth/              Auth forms, shared form fields, sign-out
    brand/             Logo, decorative marks
    shell/             App header, tab bar, cart button, sheet/dialog primitive
    locations/         Location picker, status dot, directions link
    menu/              Menu browser, product card + customiser + sheet, banners
    cart/              Cart page, quantity stepper, edit-in-place sheet
    checkout/          Checkout, Stripe Elements, pickup/tip/promo, confirmation
    orders/            Tracker, timeline, Ready alert, order lists, reorder dialog
    favorites/         Save-as-favourite form, favourites row and manager
    ui/                shadcn/ui primitives
    providers.tsx      TanStack Query + Tooltip + Toaster
  lib/
    pricing/           Shared pricing + validation engine (pure; client and server)
    menu/              Catalogue (cached), sold-out (live), page models, search
    locations/         Open/closed status, storefront context, selection cookie
    cart/              Zustand cart store (persisted)
    checkout/          Cart re-check, quote, createCheckout, pickup slots, settings
    payments/          PaymentProvider interface, Stripe, webhook handling, refunds
    orders/            Order detail + timeline, live hooks (Realtime), history,
                       reorder review, expiry job, staff cancel, deletion refunds
    favorites/         Favourite rules, queries and Server Actions
    email/             EmailProvider (Resend / Mailpit), outbox sender, dev sweep
    rate-limit.ts      Postgres fixed-window limiter (checkout, promo codes)
    client-id.ts       Browser ids / idempotency keys (works over plain HTTP)
    auth/
      actions.ts       Sign-in/up/out and password Server Actions
      dal.ts           getCurrentProfile, requireProfile, requireRole
      roles.ts         Which roles may open which routes
      schemas.ts       Zod schemas for every auth/account form
      redirect.ts      safeNextPath -- blocks open redirects via ?next=
      reauthenticate.ts  Password re-check for sensitive actions
      account-deletion.ts  Last-admin check, auth-user removal
    brand.ts           Brand copy, address, contact, setting fallbacks
    env.ts             Zod-validated environment variables
    money.ts           Integer-cent maths and USD formatting
    time.ts            Pacific/Honolulu helpers and pickup-slot generation
    order-status.ts    Order lifecycle, mirrored from SQL
    supabase/
      client.ts        Browser client (anon key, RLS applies)
      server.ts        Server Components / Actions / Route Handlers
      admin.ts         Service role — bypasses RLS, server only
      session.ts       Cookie refresh + /staff and /admin gating
  emails/              React Email templates (receipt, cancelled/refunded, ready)
  instrumentation.ts   Starts the dev-only email outbox sweep
  types/database.ts    Generated database types
  proxy.ts             Next 16 proxy (formerly middleware)
supabase/
  migrations/          Schema, RLS policies, triggers
  seed/seed.ts         Demo data
  tests/               pgTAP database tests (npm run test:db)
e2e/                   Playwright specs and their DB helpers (npm run test:e2e)
scripts/test-db.mjs    Runs supabase/tests against the local database
docs/SPEC.md           The build spec -- read before starting any phase
```

---

## Conventions worth knowing

- **Money is always integer cents.** Never a float. `src/lib/money.ts` is the
  only place cents become a decimal.
- **Time is always Pacific/Honolulu.** Vercel runs in UTC; nothing may rely on
  the ambient timezone. Use `src/lib/time.ts`.
- **The server recalculates every amount.** Client-sent totals are never
  trusted.
- **Modifiers are data, not code.** Nothing in the UI hardcodes a syrup or a
  milk option. Swapping in the real menu means changing rows (seed now, admin
  in Phase 9), never components.
- **The menu catalogue is cached for up to 60 seconds** (sold-out flags, hours
  and the pause toggle are always live). After `npm run db:seed`, restart
  `npm run dev` or wait a minute before the new menu shows.

---

## Still to confirm with the cafe

Grep for `NEEDS_CONFIRMATION` to find every placeholder. The open ones:

- [ ] Approved About / story copy from the current site
- [ ] Official brand hex values and confirmed font names (currently Baloo 2 + Inter)
- [ ] Logo files → `public/brand/`
- [ ] Instagram handle, Facebook URL, contact email, phone number
- [ ] Real trading hours for each day
- [ ] **GET rate** — seeded at 4.712% (Oʻahu visible pass-on rate)
- [ ] Whether tips should be excluded from the taxed amount (assumed yes)
- [ ] Real menu, prices, sizes and modifier upcharges
- [ ] Whether flavours are charged once or per pump (seeded as once per flavour; `modifier_groups.charge_per_quantity`)
- [ ] Product photography (a generated brand-coloured placeholder shows until then)
- [ ] Pickup-shelf wording
- [ ] Whether catering delivery is offered (assumed yes)
- [ ] Catering minimum lead time (seeded at 72 hours)
- [ ] Ordering ahead while closed: a cart already built can be scheduled for the next open day at checkout, but the menu still blocks adding while closed. Allow adding too?
- [ ] Checkout timings: unpaid checkouts expire after 30 minutes; the ASAP estimate adds 2 minutes per order in the queue; 8 orders per 15-minute slot; last slot 15 minutes before closing
- [ ] Custom tip cap (seeded at $100 or 100% of the subtotal, whichever is lower)

---

## Build phases

1. ✅ **Foundation** — setup, design tokens, migrations + RLS, seed
2. ✅ **Auth & roles** — sign-up/in/out, password reset, account page, account deletion, role-gated `/staff` and `/admin`
3. ✅ **Menu & customisation** — app shell, pickup locations and live status, menu, product sheet with data-driven modifiers, shared pricing engine, cart store
4. ✅ **Cart & checkout** — server-validated cart with edit in place, checkout with pickup slots, promos and tips, Stripe Payment + Express Checkout Elements, webhook-driven order placement, refunds, pending-order expiry
5. ✅ **Order tracking & history** — live tracker with Ready alerts, active-order cards and tab dot, history with pagination, reorder, favourites, email outbox (receipt, cancellation/refund, opt-in ready)
6. ⬜ Staff dashboard
7. ⬜ Rewards
8. ⬜ Catering, events & seasonal collections
9. ⬜ Admin dashboard
10. ⬜ Polish (PWA, a11y, performance)
11. ⬜ Testing & deploy

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
| App        | Installable PWA: Serwist service worker, offline page, standard Web Push (VAPID) |

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
| `CRON_SECRET` | **secret** | Phase 4 | Guards the `/api/cron/*` jobs (Vercel Cron sends it) |
| `RESEND_API_KEY` | **secret** | production | Set → emails go through Resend. Leave empty locally: emails go to Mailpit |
| `EMAIL_FROM` | config | production | Sender, e.g. `Drincup Cafe <orders@your-domain>`; the domain must be verified in Resend |
| `MAILPIT_URL` | config | no | Local Mailpit address; defaults to `http://127.0.0.1:54324` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public | for push | Web Push public key. `npm run push:keys` writes it. Empty = push is not offered |
| `VAPID_PRIVATE_KEY` | **secret** | for push | Signs every push. Written by `npm run push:keys` |
| `VAPID_SUBJECT` | config | for push | Contact for the push services, `mailto:` or `https:`. Set the cafe's real one before launch |
| `NEXT_PUBLIC_SW_IN_DEV` | local only | no | `true` registers the service worker under `npm run dev` (push only; no caching in dev) |
| `TEST_STORE_ALWAYS_OPEN` | local only | no | `true` = ignore store hours on a local dev server (see "Testing from outside Hawaii"). Ignored on production builds and hosted databases |

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
| `npm run test:e2e` | Playwright end-to-end tests on their **own** Supabase stack (starts, resets and seeds it; builds the app on port 3100; then proves the dev database is unchanged) |
| `npm run db:start` / `db:stop` | Start / stop the local Supabase stack |
| `npm run db:reset` | Recreate the database and re-run every migration |
| `npm run db:push` | Apply migrations to the **linked remote** project |
| `npm run db:diff` | Diff local schema against migrations |
| `npm run db:types` | Regenerate `src/types/database.ts` from the live schema |
| `npm run db:seed` | Load demo data and test accounts |
| `npm run db:seed:reports-demo` | Six weeks of clearly fake paid orders for the reports, local only (`-- --remove` takes them out); see "Admin dashboard" |
| `npm run db:clean-test-data` | Remove data automated tests left in the dev database (asks first; `-- --yes` to skip) |
| `npm run db:e2e:stop` | Stop the e2e suite's Supabase stack (frees about 1 GB of Docker memory) |
| `npm run stripe:listen` | Forward the sandbox's webhook events to `npm run dev` (`-- --port 3001` for another port) |
| `npm run stripe:doctor` | Check the Stripe setup end to end and say what to fix (prints no secrets) |
| `npm run brand:assets` | Draw every icon, launch screen, favicon and share image from `brand/logo.svg` (see "Brand assets") |
| `npm run push:keys` | Write a VAPID key pair for push notifications to `.env.local` (keeps existing keys; `-- --force` replaces, `-- --print` just prints) |
| `npm run lighthouse` | Production build, then Lighthouse (mobile) on seven pages; fails below 90 (see "Performance") |

---

## Test accounts

Created by `npm run db:seed`. Password for all three: **`DrincupTest123!`**

| Role | Email | Can reach |
| ---- | ----- | --------- |
| Admin | `admin@drincup.test` | `/admin`, `/staff`, everything |
| Staff | `barista@drincup.test` | `/staff` for the cafe and the seeded pop-up |
| Customer | `customer@drincup.test` | ordering, rewards, catering |

These three are for hand testing. The e2e suite never uses them: its own stack
is seeded with `e2e-admin@`, `e2e-barista@` and `e2e-customer@drincup.test`
(same password), and `tests/e2e-isolation.test.ts` fails if any e2e file names
the accounts above.

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

`test:db` needs the local stack running (`npm run db:start`). `test:e2e` sets up
its own (below); Docker must be running.

What the e2e suite covers beyond the flows themselves: every page any test
opens fails the test on a hydration error, an uncaught error, bad HTML
nesting or **any Content Security Policy violation** (`e2e/support/test.ts`),
so checkout with Stripe, 3-D Secure, Realtime and push are all checked
against the policy. `accessibility.spec.ts` runs axe-core (WCAG 2.1 AA) on
every main page as each kind of visitor, plus reflow at 320 px, touch
target sizes, skip links, reduced motion, the okina and kahakō in every
font weight and three keyboard-only flows. `pwa.spec.ts` covers the service
worker (what it never stores, offline, the update prompt) and push
notifications against a stand-in push service; `security-headers.spec.ts`
the headers, robots.txt, the sitemap and structured data;
`realtime-cleanup.spec.ts` that Realtime channels close on navigation.

**Browsers.** The suite drives the Microsoft Edge that ships with Windows
(Chromium). Playwright's WebKit and Firefox builds can't be downloaded on
this machine (the download times out), so Safari, iPhone and Firefox are
checked by hand: see "Cross-browser checklist".

**The e2e clock.** Tests that need "the day of the event" or "after the
collection ends" set a `dc_test_clock` cookie (an offset in milliseconds) on
their browser context (`setClock` in `e2e/support/catering.ts`). Only the
Playwright test server honours it: it needs `E2E_RUN_ID` (set only there) and
a local database, so `npm run dev` and any deployment ignore it. It moves the
server's request clock (which events are live, which collections and
limited-time products show, the staff prep list's day, catering deadlines
checked in TypeScript), never the database's own `now()`.

### Test isolation: the e2e suite has its own database

`npm run test:e2e` never touches your dev database. `scripts/e2e.mjs`:

1. Writes `.e2e-stack/` (gitignored): `supabase/config.toml` with
   `project_id = "drincup-cafe-e2e"` and every port moved up by 1000 (API
   `55321`, database `55322`, Mailpit `55324`), plus a fresh copy of the
   migrations. Studio, analytics and the edge runtime are left out.
2. Starts that second stack if it isn't running, resets it (every migration
   from scratch) and seeds it with the e2e accounts.
3. Fingerprints the dev database (row counts of orders, payments, ledger,
   outbox, webhook events, users and more; hashes of hours, closures, pause,
   sold-out flags, settings, prices, promo usage, points balances and the
   order counters), runs Playwright, then fingerprints it again. **Any change
   fails the run**, and it prints the order counts before and after. (If you
   place an order by hand on the dev app during a run, that is reported too.)

Extra arguments go to Playwright: `npm run test:e2e -- e2e/menu.spec.ts`.
`npx playwright test` on its own reuses the e2e stack as the last run left it;
the config refuses to start if that stack was never set up, or if it would
point at the dev database's port.

Cost: the e2e stack needs about **1 GB of Docker memory** on top of the dev
stack's ~2 GB. It stays up between runs (so later runs skip the start-up);
`npm run db:e2e:stop` stops it. The first start takes a minute or two.

The suite never reuses a server already on port 3100 (one left over from an
older run may have been built against the dev database). If 3100 is busy, the
run stops and says so; find the leftover `next start` with
`Get-NetTCPConnection -LocalPort 3100 -State Listen` and `Stop-Process` it.

Stripe is shared: e2e payments are real sandbox PaymentIntents. They are
tagged so the dashboard tells them apart from hand testing: the description
starts `[e2e]`, and the metadata has `source = e2e` and `e2e_run = <run id>`
(search `metadata['source']:'e2e'` in the dashboard). Refunds carry the same
metadata. If `stripe listen` forwards to your dev server during a run, the
webhook acknowledges events for payments the dev database never made and
writes nothing.

### Cleaning test data out of the dev database

```powershell
npm run db:clean-test-data           # shows what it will remove, then asks
npm run db:clean-test-data -- --yes  # no question (scripts)
```

For data from before the suite had its own stack, or from a test pointed at
the wrong database. It refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` is a
`127.0.0.1`/`localhost` URL, and it removes only:

- accounts `e2e-*@drincup.test` and `race@drincup.test` (the `points_race`
  fixture), with everything they own: orders and their lines, payments,
  refunds, status history, email outbox rows, reward snapshots, promo
  redemptions, points ledger and reservations, favourites, roster rows,
  catering requests, rate-limit counters
- anonymised orders whose idempotency key starts `e2e-`
- webhook events the suite delivered (`evt_e2e_*`), and real Stripe events
  whose PaymentIntent belongs to a test order (looked up in the sandbox)
- pauses and sold-out flags set by test accounts; availability-log rows by
  test accounts, or by the service role or seeded staff while tests were
  writing
- Mailpit messages to test accounts

It then takes test redemptions off promo usage counts and winds the daily
order and catering counters back to the highest number still in use. Seed
data and the three hand-testing accounts, with everything they own, are kept.

It runs in one transaction through `docker exec` into the local database
container, with foreign keys and the ledger's triggers on. The one exception
is `order_items_freeze` (paid orders' lines are immutable): it is disabled by
name inside that transaction, under the exclusive lock `ALTER TABLE` takes,
and re-enabled before commit. There is no database function for this, so
nothing a hosted project could call.

- **Database tests** run each file in `supabase/tests` inside a transaction
  that is rolled back, so they leave nothing behind. `scripts/test-db.mjs`
  pipes them into the running database container, rather than using
  `supabase test db`, because Docker Desktop on Windows intermittently fails
  the bind mount that command needs.
- **The page guard** (`e2e/support/test.ts`): every spec imports `test` and
  `expect` from there, not from `@playwright/test` (a unit test enforces
  it). It watches every page a test opens, including extra browser contexts,
  and fails the test on any uncaught error (a hydration mismatch arrives this
  way, as React error #418 in the production build), on console errors about
  hydration or React, and on invalid nesting left in the DOM (a link or
  button inside a link or button, a block inside a `<p>`). A test that
  causes an error on purpose lists it with
  `test.use({ allowedPageErrors: [/…/] })`. `e2e/console-health.spec.ts`
  loads the main pages fresh signed out, as a customer (no orders, an order
  in progress, an unpaid checkout, items in the cart), as the barista and as
  the admin, so every one of them hydrates under the guard.
- **End-to-end tests** build the app and serve it on port 3100, so they never
  clash with `npm run dev`. On Windows they drive the Microsoft Edge that ships
  with the OS, so nothing needs downloading. Elsewhere, run
  `npx playwright install chromium` once. `PLAYWRIGHT_CHANNEL` overrides the
  browser (`chromium`, `chrome` or `msedge`). The tests change real rows in
  the e2e stack (the pause toggle, sold-out flags, opening hours) and put them
  back afterwards, so they run one at a time.
- **Checkout tests** (`e2e/checkout.spec.ts`, `e2e/webhooks.spec.ts`) pay
  with Stripe test cards in the sandbox, so they need the three Stripe test
  keys in `.env.local` (they refuse a live key). They do **not** need
  `stripe listen`: the test server on 3100 is not where the CLI forwards, so
  the tests fetch the real events from Stripe's Events API (or build signed
  fixtures around real PaymentIntents) and deliver them to the webhook
  themselves. If `stripe listen` is also forwarding to your dev server, the
  dev server ignores those events without writing anything (the payments are
  not in its database).
- **Tracking tests** (`e2e/tracking.spec.ts`) move orders along as the
  e2e stack's barista (a real signed-in Supabase client calling
  `advance_order_status`), listen on real Realtime sockets, and read the
  receipt and cancellation emails from the e2e stack's Mailpit
  (`http://127.0.0.1:55324`), not yours.
- **Concurrency tests** (`supabase/tests/*.concurrent.mjs`, run by
  `npm run test:db`) cover what one transaction cannot: several real database
  sessions at once. `points_race.concurrent.mjs` holds one checkout's
  transaction open while another tries to spend the same points, then fires
  five at once. They commit their own fixtures and delete them afterwards,
  and give back the order numbers they took, so they leave no trace in the
  dev database.
- **Rewards tests** (`e2e/rewards.spec.ts`) give points with
  `admin_adjust_points`, redeem in real checkouts (sandbox card, real
  webhook), let a reserved checkout expire through the cron route, race two
  browser sessions for the same points, refund through Stripe, and open the
  staff ticket on a tablet-sized window.
- **Staff dashboard tests** (`e2e/staff.spec.ts`) run on a third Playwright
  project, `tablet` (1280×800 landscape, tests tagged `@tablet`), plus a
  phone-width check on `mobile`. They open real customer and barista
  windows side by side, wait on real timers (the undo window, the repeating
  chime, which the suite shortens to 5 seconds, and a scheduled order falling
  due about 20 seconds after it is placed), cancel a real sandbox payment,
  and stub `window.print` to count what would have printed.

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
3. In a second PowerShell window, forward webhooks to the dev server:

   ```powershell
   npm run stripe:listen
   ```

   It reads `STRIPE_SECRET_KEY` from `.env.local` and hands it to the CLI, so
   the CLI listens to the same account the payments are made in (a plain
   `stripe login` can point at a different account). It is the same as:

   ```powershell
   stripe listen --api-key <STRIPE_SECRET_KEY> --events payment_intent.succeeded,payment_intent.payment_failed,payment_intent.canceled,charge.refunded --forward-to localhost:3000/api/webhooks/stripe
   ```

4. It prints a signing secret (`whsec_…`). Put it in `.env.local` as
   `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`. The secret stays the
   same between runs for the same account and machine.
5. Check everything with `npm run stripe:doctor` (with `npm run dev`
   running): keys set and in test mode, both from the same account, the CLI
   installed, the webhook secret the one `stripe listen` signs with, and the
   dev server's webhook route answering. It prints no secrets.

**Payments land through the webhook.** If it is slow or missing (the
listener is not running), the confirmation page and the catering pay page
ask the server after about 6 seconds to read the payment from Stripe's API
and apply it the same way (the reconcile fallback), so you still get to
"Mahalo!". Keep the listener running anyway: refunds made in the Stripe
dashboard, declines and cancellations only arrive through it.

The four events are exactly what the app handles (one list:
`scripts/lib/stripe-events.mjs`, checked against the webhook by a unit
test). Catering payments use the same four (they are PaymentIntents tagged
`metadata.type = catering`): **no new events in Phase 8**. In production,
create a webhook endpoint in the dashboard for
`https://<domain>/api/webhooks/stripe` with the same four events, and use its
signing secret.

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

With `npm run dev` and `npm run stripe:listen` running:

1. Sign in as `customer@drincup.test`, add a Latte, open the cart, press
   **Checkout**.
2. Pay with `4242…`. You land on "Confirming your payment…", then **Mahalo!**
   with the order number once the webhook arrives (watch the `npm run stripe:listen`
   window for `[200] POST /api/webhooks/stripe`). The cart empties.
3. Again with `4000 0000 0000 0002`: the decline shows on the checkout page;
   pay again with `4242…` and it completes the **same** order.
4. Again with `4000 0025 0000 3155`: complete the 3-D Secure test page.
5. Promo codes: `MAHALO10` (10% off $10+), `ALOHA5` ($5 off $25+, so it
   explains the minimum spend), `SPRING24` (expired: "This code can't be
   applied.").
6. Refund from the Stripe dashboard (Payments → the payment → Refund): the
   order turns Refunded once `charge.refunded` arrives.
7. Pause the location (as the barista on `/staff`: **Pause online orders**)
   and try to pay: checkout refuses. A payment already in flight when you
   pause is refunded automatically, and the confirmation page says why.

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
    { "path": "/api/cron/send-emails", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/expire-points", "schedule": "0 13 * * *" }
  ]
}
```

`/api/cron/expire-points` (daily; 13:00 UTC is 3 AM in Honolulu) expires
Overflow Rewards points past `loyalty.points_expire_after_months`. The
setting is 0 (never), so it does nothing until the cafe decides otherwise.

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

1. `npm run dev` (and `npm run stripe:listen` if you pay through
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

## Overflow Rewards (trying it by hand)

The rules (earn rate, stacking, rewards per order, catering, expiry) are
settings, all awaiting the cafe's answers; see ARCHITECTURE.md, "Overflow
Rewards", for how the ledger works.

**Give the test customer points.** In Supabase Studio
(http://127.0.0.1:54323 → SQL Editor), run:

```sql
select public.admin_adjust_points(
  (select id from public.profiles where email = 'customer@drincup.test'),
  300,
  'Hand testing'
);
```

A negative number takes points away. The reason is required, and it shows in
the customer's activity log.

1. **Rewards page.** Signed out, open `/rewards`: the programme, the three
   tiers and "How it works" (its numbers come from the settings). Sign in as
   `customer@drincup.test`: the balance, progress to the next tier, which
   tiers you can afford, your member QR and the activity log (Honolulu
   times). Home shows the balance and progress under the greeting.
2. **Redeem.** Add a Latte and a Macadamia Nut Cookie, go to checkout, and
   under **Use a reward** tap **Use** on *Free drink*. The totals show
   "Free drink: Latte −$5.75", GET and the tip are worked out on what is
   left, and "You'll earn 3 points when you pick this up." Pay with
   `4242 4242 4242 4242` (with `npm run stripe:listen` running). The confirmation
   and the receipt email (Mailpit, http://127.0.0.1:54324) show the reward,
   and `/rewards` shows 150 points redeemed.
3. **Staff ticket.** As `barista@drincup.test` on `/staff`, the latte carries
   a magenta "REWARD · Free drink" tag (and the printed ticket says REWARD).
   Walk it to **Picked up**: the customer's points arrive.
4. **One discount per order.** With two lattes in the cart, apply
   `MAHALO10`, then use a reward: the promo comes off with a message saying
   why. Apply the code again and the reward comes off.
5. **A free order.** A Latte alone with *Free drink* is $0.00: the card form
   is replaced by **Place order · $0.00**.
6. **Points held, then returned.** Use a reward and pay with the declined
   card `4000 0000 0000 0002`. `/rewards` shows the points as held. Either
   let the checkout expire (30 minutes, then call
   `/api/cron/expire-orders` as under "Scheduled jobs") or, from checkout in
   another tab, tap **Cancel that checkout and use them now**. The activity
   log shows them returned.
7. **Refunds.** Refund a picked-up order in the Stripe dashboard (with
   `npm run stripe:listen` running): half the money reverses half its points
   (rounded down); the rest reverses them all and returns any points spent
   on a reward. If those points were already spent, the balance goes below
   zero and rewards are paused until it is positive again.
8. **Member code.** On `/rewards` or `/account`, **Regenerate code** →
   **Yes, new code**: a new code and QR; the old one stops working. There is
   no in-store scanner yet; `staff_lookup_member(code)` is ready for one and
   returns only a first name and a balance, to signed-in staff only (so it
   refuses a Studio session; `supabase/tests/overflow_rewards.test.sql`
   covers it).

---

## Staff dashboard (`/staff`)

The barista screen, built for a landscape tablet on the counter (1024–1366 px
wide) and usable on a phone. Sign in as `barista@drincup.test` (or the admin)
and open `/staff`.

### Using it

- **Start shift.** The queue appears after one tap on **Start shift**. That
  tap turns on the new-order sound (browsers block sound until you tap),
  keeps the screen awake, and goes fullscreen if you tick the box (the choice
  is remembered on the device). After reloading the page, tap Start shift
  again.
- **Location.** The top line shows the counter, whether it is open, closed or
  paused, and today's hours. If you work more than one counter (the cafe and
  a pop-up running today), pick it from the menu there; the device remembers
  it. Admins see every location.
- **Columns.** **Upcoming** (scheduled orders not due yet), **New**, **In
  progress** (Accepted or Preparing, shown on the ticket) and **Ready**. A
  scheduled order moves from Upcoming to New at pickup time minus the
  location's prep time, and rings like a new order. On a phone the columns
  are tabs.
- **One tap per step.** New → **Accept** → **Start** → **Ready** → **Picked
  up**. Ready and Picked up wait five seconds with a big **Undo** before they
  are sent, so a mis-tap never reaches the customer. If someone else already
  moved the order on another screen you'll see "Already updated" and the
  ticket refreshes.
- **Tickets** show the cup name, order number, ASAP or the pickup time, and a
  timer since the order was placed. They turn amber 5 minutes and red 10
  minutes past the estimated ready time (settings `staff.ticket_warning_minutes`
  and `staff.ticket_late_minutes`). Notes and special instructions are boxed
  in pink; allergens are flagged in red.
- **Tap a ticket** for the full order, its history (who did what, when),
  **Print ticket**, **Print cup labels** and **Cancel order**. Cancelling asks
  for a reason and says exactly how much will be refunded before anything
  happens; the customer's tracker and the cancellation email follow
  automatically.
- **New-order alert.** A chime that repeats every 15 seconds
  (`staff.new_order_repeat_seconds`) until you open the order or tap
  **Acknowledge**, a flashing outline, and the count in the tab title. The
  speaker button mutes it; the slider sets the volume. Both are remembered on
  the device.
- **Pause online orders** for a rush: 15, 30 or 60 minutes, or until you
  resume. A banner counts down while paused; customers can browse but not
  check out. It resumes by itself when the time is up.
- **Sold out**: search any drink, food item or option (milks, syrups…) and
  switch it off, **until end of day** (it comes back at the next day's opening,
  Honolulu time) or **until I turn it back on**. The menu and every cart see
  it straight away. Who changed what is recorded (`location_availability_log`).
- **Catering**: today's confirmed catering orders for this counter, as a prep
  list with the paid quote's lines (sizes and quantities, no prices), the
  contact's phone and any notes. After the event, **Mark fulfilled**.
- **Completed**: today's picked-up and cancelled orders, searchable by order
  number or cup name.
- **Offline.** A red "Offline — reconnecting…" banner means new orders may be
  missing; taps fail with a message instead of being saved for later. It
  catches up by itself when the connection is back.

### Two windows by hand (customer and barista)

1. `npm run dev` (plus `npm run stripe:listen` if you pay through
   checkout).
2. **Window A** (normal): sign in as `customer@drincup.test`. **Window B**
   (InPrivate / a second browser, so the sessions don't mix): sign in as
   `barista@drincup.test`, open `/staff`, tap **Start shift**.
3. In A, place an order and open its tracker (tap the page once so it may
   play the Ready sound). In B it appears under **New** within a second or
   two, ringing and flashing.
4. In B: **Accept** → **Start** → **Ready** (watch the five-second Undo) →
   **Picked up**. A follows each step; at Ready it shows the banner and plays
   its chime.
5. Try **Undo** during the Ready countdown: the order stays Preparing and A
   hears nothing.
6. Place another order; in B open it, **Cancel order**, pick a reason: A shows
   Refunded and the cancellation email lands in Mailpit.
7. Mark the Latte sold out in B, then open the menu and the cart in A.
8. Pause for 15 minutes in B and try to check out in A.
9. Open `/staff` in a third window (as the admin) on the same order and tap
   the same buttons in both: no errors, both end up right.

### Recommended tablet settings

- Plugged in on the counter; screen timeout set to **never** (or "while
  charging"). The dashboard also asks the browser to keep the screen awake,
  but a system timeout can still win, and some browsers don't support it (a
  note appears on the dashboard).
- Landscape, rotation locked; brightness high, auto-brightness off.
- Media volume up and not on silent / Do Not Disturb, or the chime is muted
  by the system.
- One app only: Android **screen pinning** (or Chrome kiosk mode below), iPad
  **Guided Access**.
- Chrome on Android or Windows, or Safari on iPad (iPadOS 16.4+ for the
  wake lock). Allow sound for the site if the browser asks.
- Turn off battery saver: it can stop the wake lock and throttle the timers.

### Kiosk printing (silent printing on the counter device)

Browsers always show a print dialog unless Chrome is started in kiosk mode
with kiosk printing. On a Windows counter PC or tablet:

1. Install the receipt printer (80 mm) and/or label printer driver and print a
   test page from Windows.
2. Make the printer you want the dashboard to use the **Windows default**
   (Settings → Bluetooth & devices → Printers & scanners; turn off "Let
   Windows manage my default printer").
3. Set its paper in the driver: 80 mm roll for tickets, or the label size
   (57 × 32 mm by default; change `staff.label_width_mm` /
   `staff.label_height_mm` to match your labels). Margins: none.
4. Make a desktop shortcut whose target is:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --kiosk-printing https://<your-domain>/staff
   ```

   `--kiosk` opens full screen with no browser UI (Alt+F4 closes it);
   `--kiosk-printing` sends every print straight to the default printer
   without a dialog.
5. Open it once, print a ticket from the dashboard with the dialog off, and
   check the layout. If Chrome keeps using the wrong printer, set the policy
   `PrintPreviewUseSystemDefaultPrinter` to true
   (`chrome://policy` shows it once set via the registry or Group Policy).
6. To start it with Windows, put the shortcut in `shell:startup`.

Kiosk printing uses one printer per Chrome window. With a receipt printer and
a label printer on the same device, run the dashboard on one device per
printer (or keep one of them on the normal print dialog). Chrome on Android
and Safari on iPad have no silent printing: they always show the system print
dialog, where you pick the printer and paper.

---

## Catering, pop-up events and collections (trying it by hand)

How it works inside: [ARCHITECTURE.md](ARCHITECTURE.md#catering-workflow).

**Before you start.** A database from before Phase 8 needs the two new
migrations: `npx supabase migration up` applies them and keeps your data. For
the Phase 8 samples (below) start fresh instead: `npm run db:reset`, then
`npm run db:seed` (this wipes the dev database). Then `npm run dev` and, in a
second window, `npm run stripe:listen`. Emails land in Mailpit at
<http://127.0.0.1:54324>; admin notifications go to `catering@drincup.test`
(setting `catering.admin_notification_email`).

**Windows.** Use separate sessions so the sign-ins don't mix:

| Window | Account | For |
| ------ | ------- | --- |
| A (normal) | `customer@drincup.test` | requesting, paying, events, collections |
| B (InPrivate, or a second browser) | `admin@drincup.test`, then open `/admin` | quoting, cancelling, events, collections |
| C (another browser profile) | `barista@drincup.test`, then open `/staff` | the prep list |

**The samples** (from `npm run db:seed`, all marked as samples):
a **Submitted** request (office anniversary, two weeks out), a **Quoted**
one (launch party with a signature drink, six weeks out, payable for a
week), a **Confirmed** one for today at noon (on the staff prep list); the
**Kakaʻako** pop-up two weeks out (published) and a **past** sample pop-up
(only in the admin's Past list); the **Summer Sunset** collection with the
limited-time **Sunset Hibiscus Spritz**, which is on the menu only while the
collection runs.

### Catering

1. **A:** Home → *Catering for your event* (or `/catering`). Signed out, the
   page explains catering and asks you to sign in.
2. **A:** pick tomorrow as the date and send: refused, *too soon* (72 hours'
   notice). Pick a date five or more days away, 11:00, 30 guests; add *Cold
   Brew* (Medium) and *POG Refresher*, set the quantities; tick *A custom
   signature drink* and describe it; choose *Delivery*, type ZIP **96720**
   (Hilo: "we don't deliver to 96720") then **96813**; **Send request**. You
   get the `CAT-…` number and what happens next. Mailpit: *We got your
   catering request* (to you) and *New catering request* (to
   `catering@drincup.test`).
3. **B:** `/admin` shows it in *New catering requests*, and Catering has a
   badge. Open it: the quote builder is filled in from what was asked for at
   menu prices. Set the signature line to "Signature drink: …" at $6.50,
   leave the $25.00 delivery fee, try a 10% discount and the gratuity box,
   watch the preview, **Send quote**. Mailpit: *Your catering quote*.
4. **A:** Account → *My catering* → the request: the quote, its lines and the
   pay-by time. **Request changes**, write something, send: the request goes
   back to *Submitted*. Mailpit: *Changes requested on a catering quote*.
5. **B:** reload: *Revise the quote* starts from version 1; change a price,
   **Send revised quote**. *Quote versions* shows v1 (superseded) and v2.
6. **A:** reload → **Accept & pay** → card `4000 0000 0000 0002` (declined;
   try again on the same page) then `4242 4242 4242 4242` → *Mahalo! You're
   confirmed.* Mailpit: the receipt (lines, totals, Visa •••• 4242) and
   *Catering payment received*. **B:** the payment shows under *Payments and
   refunds*.
7. **A:** on the confirmed request, **Ask to cancel**, give a reason. Mailpit:
   *Cancellation requested*. **B:** the request shows the reason;
   **Cancel and refund** → *Partial refund* → $10.00. The refund appears in
   the Stripe dashboard and under *Payments and refunds*; Mailpit: *was
   cancelled*, "We've refunded $10.00 of the $… you paid".
8. **C:** `/staff` → Start shift → **Catering**: today's sample (Malia Office
   Manager, noon) with its quoted lines. **Mark fulfilled**. (A request you
   made in step 2 appears here on its event day; to see one today, set its
   `event_at` to today in Studio before paying.)
9. **B:** `/admin/catering?view=calendar`: quoted (pink) and confirmed (teal)
   events by month or week. The inbox filters by status, pickup/delivery and
   event dates, and searches by number, name or email.
10. **An expired quote:** in B, send a quote expiring in 15 minutes (the
    expiry picker is in Honolulu time); after it passes, A sees "This quote
    has expired" and no **Accept & pay**; B can send a new one (until the
    payment deadline, 48 hours before the event).

### Pop-up events

1. **B:** `/admin/events` → **New event**: a name, tomorrow, 10:00–14:00, an
   address (or a Google/Apple Maps link), add two drinks with the menu
   search, tick Kekoa Barista under Staff, optionally upload a photo
   (JPEG/PNG/WebP up to 5 MB) → **Create event**. It is a draft. **A:**
   `/events` doesn't show it.
2. **B:** **Publish**. **A:** `/events` shows it under *Coming up*, with the
   menu preview and Directions; Home lists it under *Upcoming pop-ups*.
3. **Live:** edit the event so it started an hour ago today (date today,
   start time an hour back) and save. **A:** `/events` shows *Open now* →
   **Order for pickup here** → the menu has only its drinks; checkout works
   while it runs. **C:** the barista can open its queue from the location
   menu on `/staff`.
4. **B:** **Duplicate to another date** → a copy on that date with the same
   times, menu and staff, unpublished.
5. **B:** **Unpublish**: it disappears from `/events`, Home and the pickup
   location switcher at once. An event that has ended disappears by itself.

### Seasonal collections

1. **B:** `/admin/collections` → **New collection**: a name, starting now-ish
   and ending in a few days; accent **#1AB3C0** (the form warns it fails
   contrast for text and explains it is only used for decoration); upload a
   banner (the form reminds you artwork must be the cafe's own) and watch the
   preview; add products, and tick **Limited time** on one that is not in
   another collection (e.g. Matcha Latte) → **Create collection**.
2. **A:** `/menu`: your collection takes the banner (the newest running one
   wins) → *See the collection* → `/collections/<slug>`.
3. **B:** set the end to earlier today and save. **A:** the limited-time
   product is gone from the menu; a cart holding it says "This limited-time
   item is no longer on the menu."; the collection page says "This
   collection has ended" with a link to the menu.

## Admin dashboard (`/admin`)

Sign in as `admin@drincup.test` and open `/admin` (or **Account → Admin**).
Everything the owner changes day to day is here; nothing needs Supabase
Studio. Every change is recorded in the **Audit log** (who, when, what it was
before and after). How it works inside:
[ARCHITECTURE.md](ARCHITECTURE.md#the-admin-dashboard).

**Before you start.** A database from before Phase 9 needs the four new
migrations: `npx supabase migration up` keeps your data.

### Day to day

| To… | Go to |
| --- | ----- |
| See what needs you | **Home**. The *Needs attention* list (also a badge in the menu): payments that didn't match their order, failed refunds, failed emails, new catering requests and changes, unpaid orders stuck past expiry. Each links to its page and disappears once handled. Below it: today's sales, orders and average order value, and how much of the setup checklist is confirmed. |
| Pause ordering for a while | **Home → Pause online orders**, or **Locations → Pause** (pick how long; it resumes by itself). Staff can pause from `/staff` too. |
| Mark something sold out | **Menu → Sold out** (per location; the same switch staff use). |
| Change a price, description or photo | **Menu → Products → the product**. The preview on the right is exactly what customers will see. A new price applies to new carts and orders; carts already holding the item show the new price with a notice; past orders keep what was paid. |
| Add a product | **Menu → Products → New product**. Add sizes (each with its price, one default) or a single price; attach modifier groups and drag them into order; "Only show when" hides a group until an option is picked (Ice only when *Iced*). |
| Change syrups, milks, toppings | **Menu → Modifiers**. A group's options, upcharges, defaults and limits are shared by every product it's on. |
| Reorder the menu | **Menu → Categories** (drag, or use *Move up / Move down*). |
| Remove an item | **Archive** it. Anything ever ordered, favourited or used on an event menu is kept for history and only hidden; only something never used can be deleted outright. |
| Change hours or close for a holiday | **Locations → the cafe → Hours** (several ranges a day; a day with none is closed) and **Closures** (a whole day closed, or holiday hours). Customers see changes at once. |
| Edit settings (tax, tips, pickup timing, rewards, catering, emails) | **Settings**. Each shows its help, checks its value and keeps its history (*History*). |
| Edit About, contact, social links, logo, privacy, terms, refund policy | **Content**. The customer pages `/about`, `/privacy` and `/terms` read these. |
| Work through the placeholders | **Setup**. Everything still marked to confirm with the cafe, its current value and a link to edit it; tick **Confirmed** when the cafe has signed it off. |
| Run a promotion | **Promotions → New code**. Once a code has been used its code and discount are locked (dates, limits and the on/off switch stay editable). *Redemptions* lists each use. |
| Look after rewards | **Rewards**: tiers (order, cost, on/off), programme settings, totals, and *Members* to look someone up and adjust their points (with a reason). |
| Find or refund an order | **Orders**: search by number, name or email; filter by date, location, status and payment. The order page cancels with a full or partial refund, refunds a picked-up order, and resends the receipt. |
| Give someone staff access | **Users → the person → Role** (your password is asked again), then tick their locations. Demoting staff to customer removes their locations. You can't change your own role, and the last admin can't be demoted. |
| Catering, pop-ups, collections | **Catering**, **Events**, **Collections** (Phase 8). |
| See how the cafe is doing | **Reports** (below). |
| See who changed what | **Audit log**: filter by person, table and dates. |

### Importing the menu

For loading the real menu in one go (or a batch of changes) from a
spreadsheet: **Menu → Import** (`/admin/menu/import`).

1. Download the **template** (Excel or CSV) or the **filled-in example**. The
   Excel file has a second sheet, *How to fill*, explaining each column.
2. One row per product:
   - **Category**, **Product** (required). A new category name creates the
     category.
   - **Slug**: the item's web address, e.g. `ube-latte`. Leave blank to make
     one from the name. Importing again matches items by slug, so keep it the
     same to update an item rather than add a second one.
   - **Price** for single-price items (`3.75`: no `$`, always two decimals),
     **or Sizes** as `Small=5.25; Medium*=6.00; Large=6.75` (`*` marks the
     default size; otherwise the first).
   - **Modifier groups** by their short name from Menu → Modifiers, separated
     by semicolons. `ice-level if Iced` shows that group only when *Iced* is
     picked.
   - **Allergens** and **Dietary** from the listed words, comma-separated;
     **Catering** `yes` if it can be ordered for catering; **Active** `no` to
     add it switched off.
3. Upload it and press **Preview**. Nothing changes yet. The preview shows
   each row as new, changed (with what changes) or unchanged, any new
   categories, and every problem by row and column ("Row 4, Price: write
   $5.00 as 5.00"). Fix the file and preview again until there are no errors.
4. Tick **Archive products that aren't in this file** only if the file is the
   whole menu. Otherwise items not in the file are left alone. Nothing is
   ever deleted.
5. **Apply import** and confirm. It applies all of it or none of it, and adds
   one entry to the audit log.

Limits: `.xlsx` or `.csv`, up to 2 MB. Only the first sheet named *Menu* (or
the first sheet) is read, as values only. Cells starting with `=`, `+`, `-`
or `@` are refused (spreadsheet formulas), and macro-enabled workbooks
(`.xlsm`) and old `.xls` files are refused. Photos are added afterwards in the
product editor.

**Try it with the example:** download *Filled-in example (Excel)*, upload it
unchanged, **Preview**: *6 rows: 6 new*, new category *Bakery*. **Apply
import**, confirm, then open `/menu`: Ube Latte (Iced shows the ice-level
choice), Hōjicha Latte, Lilikoʻi Hibiscus Cooler, Spam Musubi, Butter Mochi
and Haupia Pie Slice. Upload the same file again: *0 new, 0 changed, 6
unchanged*. Change a price in the file and preview again: that row shows as
changed, old → new. To undo, archive the six products (Menu → Products).

### Reports

**Reports** (`/admin/reports`): pick *Today*, *Yesterday*, *Last 7 days*,
*This month*, *Last month* or your own dates (Hawaiʻi calendar days), and
optionally one location or pop-up. Every card has an ⓘ explaining exactly
what it counts; the full definitions are in
[ARCHITECTURE.md](ARCHITECTURE.md#reports). In short: paid orders only, by
the day they were placed; refunds come off the day of the order they belong
to; net sales = gross − discounts − refunds, with tax and tips reported
separately.

Each report has a **CSV** download, and **Orders export (CSV)** gives the
accountant one row per order with every breakdown (its totals add up to the
report for the same range).

**Demo data.** A fresh dev database has almost no paid orders, so the charts
are empty. To fill them:

```powershell
npm run db:seed:reports-demo            # six weeks of fake paid orders (local only)
npm run db:seed:reports-demo -- --remove   # take it all out again
```

It adds about six weeks of clearly fake orders (numbers `DC-…-9NNN`,
customers `demo-N@reports.drincup.test`, codes `DEMO-WELCOME10` and
`DEMO-5OFF`, two switched-off pop-ups, three paid catering requests), with
promos, rewards, tips and refunds, plus one **failed email** and one
**failed refund** for the Home attention list. It never calls Stripe or sends
email, refuses to run against anything but the local database, replaces
itself when run again, and `--remove` leaves the database as it was.
`npm run db:clean-test-data` does not touch it.

### Trying it by hand

Run `npm run dev` and `npm run stripe:listen`. Use an InPrivate window for
the admin and a normal one for the customer so the sign-ins don't mix.

1. **Home and the attention list.** `npm run db:seed:reports-demo`, then
   `/admin`: the badge shows 2 or more. The failed email shows its error;
   **Retry** sends it (Mailpit, <http://127.0.0.1:54324>) and leaves
   the list. Open the failed refund: **Mark handled** with a note.
2. **Menu.** Products → *Cold Brew*: change Medium's price; the preview
   updates as you type; **Save product**. In the customer window a cart that
   already had Cold Brew shows the new price with a notice. Products → New
   product → add sizes, attach *Hot or Iced* and *Ice*, set Ice to *Only show
   when Iced is selected*; flip the preview between Hot and Iced. Type a
   price like 5.255 and save: it says what's wrong. On a product that has
   been ordered, **Delete** is unavailable ("Used in N orders") and
   **Archive** hides it instead; a brand-new unused one can be deleted.
3. **Import** with the example (above).
4. **Locations.** Remove today's hours: the customer's menu shows *Closed*.
   Add a closure for tomorrow: tomorrow's pickup times disappear at checkout.
   Put the hours back.
5. **Settings.** Change *Tip choices at checkout* to 0, 10, 15, 20; the checkout tips change;
   *History* shows the change, and so does the Audit log.
6. **Setup.** Tick *Confirmed* on the GET rate; Home's progress goes up.
7. **Promotions.** New code `HANDTEST` for 10% off; use it at checkout in
   the customer window; back in admin the code and discount are now locked,
   and *Redemptions* lists the order.
8. **Rewards → Members.** Find `customer@drincup.test`, **Adjust points** +25
   with a reason; the customer's `/rewards` shows it in their activity.
9. **Orders.** Open a picked-up order, **Cancel and refund**, choose a
   partial amount; the confirm says exactly what will be refunded; the
   customer's order page shows the refund.
10. **Users.** Make `customer@drincup.test` staff (your password is asked),
    tick a location; then back to customer: their locations are removed. Your
    own role has no change button.
11. **Reports.** *Last month*: sales, orders, the hourly chart, the peak-hours
    heatmap, top products and add-ons, discounts, catering. Download *Orders
    export (CSV)* and check its *Net sales* column adds up to the card.
12. **Audit log.** Everything above is listed with before → after.
13. Clean up: `npm run db:seed:reports-demo -- --remove`. A used code can't
    be deleted, so switch `HANDTEST` off; put the tip choices back to 0, 15,
    18, 25.

---

## The installable app, offline and notifications

Drincup installs like an app (a PWA): its own icon, full screen, a launch
screen, shortcuts to Menu, Orders and Rewards, an offline page, and "Your
order is ready" notifications even with the app closed. How it works is in
ARCHITECTURE.md ("The installable app", "Push notifications").

The service worker runs in **production builds** (`npm run build`, then
`npm run start`), never in `npm run dev` unless you ask (below): dev chunks
change constantly and must not be cached. Installing and notifications need
**HTTPS** (localhost counts); a phone on `http://192.168.x.x` gets neither, see
"Testing on a phone over HTTPS".

### Installing the app

- **iPhone and iPad (Safari):** tap **Share**, then **Add to Home Screen**, then
  **Add**. Open Drincup from the new icon. Notifications need iOS 16.4 or
  later and only work in the Home Screen app, not in Safari.
- **Android (Chrome, Edge, Samsung Internet):** after an order goes through,
  the confirmation page offers **Add Drincup to your home screen**; or use the
  browser menu → **Install app** / **Add to Home screen**. Long-press the icon
  for the Menu, Orders and Rewards shortcuts.
- **Desktop Chrome and Edge:** the install icon in the address bar.

The app never asks on a first visit. After the first successful order, the
confirmation page offers it once (the browser's own dialog on Android and
desktop, the two Share steps on iPhone); "Not now" is remembered.

### Offline and updates (trying it by hand)

```powershell
npm run build
npm run start
```

Open <http://localhost:3000>, browse a few pages (Home, Menu, a drink), then in
DevTools → **Network** pick **Offline**:

- reload **Menu**: the last copy, with the **Offline** banner under the header
- open **Checkout** or **Account**: the offline page ("You're offline. Your
  cart is saved on this device. Reconnect to place your order.")
- the cart keeps its items; **Reconnect to check out** until you're back online

DevTools → **Application** → **Cache storage** shows what is kept: hashed
scripts, styles and fonts, menu images, and the public pages. Never checkout,
cart, orders, account, sign-in, staff, admin, the API, Supabase or Stripe.

**Updates:** rebuild and restart the server while a tab is open. Within 30
minutes, or as soon as you switch back to the tab or open another page, "A new
version is available. Refresh" appears; nothing changes until you tap
Refresh. On checkout, Pay waits for that refresh (your cart is kept).

### Push notifications ("Your order is ready")

Standard Web Push with our own keys; no account with anyone.

```powershell
npm run push:keys      # writes NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT to .env.local
```

Restart the server afterwards. The script keeps keys that are already there:
every device that turned notifications on is tied to the public key, so new
keys silently cut them all off (`-- --force` replaces them anyway). For
production, run `npm run push:keys -- --print` once and put the three values
in the Vercel project's environment variables; set `VAPID_SUBJECT` to the
cafe's real contact (`mailto:` or an `https:` page; `NEEDS_CONFIRMATION`).

For a customer: on the order page, **Notify me when it's ready** (or Account →
**Notifications** → **Turn on notifications**), then **Allow**. Account →
Notifications shows every device it is on, each removable; signing out turns
it off on that device.

**Trying it on this computer** (Chrome or Edge, production build as above,
or `npm run dev` with `NEXT_PUBLIC_SW_IN_DEV=true` in `.env.local`):

1. Windows Settings → System → Notifications: on for Chrome/Edge.
2. Sign in as `customer@drincup.test`, place an order, and on its page tap
   **Notify me when it's ready** → **Allow**.
3. In a private window, sign in as `barista@drincup.test`, open `/staff`,
   Start shift and move the order to **Ready**.
4. The notification arrives within seconds, with the tab closed too (the
   browser must still be running). Tapping it opens the order.

In Studio, `push_outbox` shows each push and what happened to it. A device
the push service reports gone (404 or 410) is dropped from `push_subscriptions`.

### Brand assets: swapping in the real logo

Every icon, the favicon, the Apple touch icon, the iOS launch screens and the
share image (Open Graph and Twitter) are drawn from **one file** by **one
script**:

1. Replace `brand/logo.svg` with the cafe's logo mark: square-ish, transparent
   background. (A PNG works too: save it as `brand/logo.png`, at least
   1024 × 1024, and delete `brand/logo.svg`.)
2. If the brand colours are confirmed, update `BRAND_COLORS` in
   `src/lib/brand.ts` and the matching `--brand-*` values in
   `src/app/globals.css` (`npm test` fails if they differ).
3. Run `npm run brand:assets` and commit what it lists (`public/icons`,
   `public/splash`, `src/app/favicon.ico`, `apple-icon.png`,
   `opengraph-image.png`, `twitter-image.png`).

The share card and launch screens set the name ("drincup cafe") in Baloo 2
next to the mark. The logo in the app header is separate: upload it in Admin →
Pages & contact.

### Performance (`npm run lighthouse`)

Builds for production, serves it on port 3200 with your `.env.local` (the
local dev database; pages are opened signed out, nothing is written), and runs
Lighthouse's mobile preset on Home, Menu, a product page, Cart, Rewards,
Events and Catering: three runs each, the median counts, and it fails if any
category is under 90. Reports land in `.lighthouse/<page>.html`.

```powershell
npm run lighthouse                         # build + all pages
npm run lighthouse -- --skip-build         # reuse the last build
npm run lighthouse -- --only home,menu --runs 1
npm run lighthouse -- --url https://<preview>.vercel.app   # a deployed site
```

It uses Chrome if installed, else Microsoft Edge (`CHROME_PATH` overrides).
Cart is kept out of search on purpose (robots.txt), which Lighthouse's "Page
is blocked from indexing" always fails; that one audit is left out of Cart's
SEO score and the run says so. Results before and after Phase 10 are in
ARCHITECTURE.md ("Performance"); Menu and Product sit right at 90, so a single
run can dip a point.

### Cross-browser checklist

Automated tests run in Edge (Chromium). Before launch, and after big changes,
go through this on real devices (over HTTPS: a Vercel preview, or "Testing on a
phone over HTTPS" below). Test card `4242 4242 4242 4242`; 3-D Secure card
`4000 0025 0000 3155`.

| Check | iPhone Safari | iPhone, installed | Android Chrome | Android, installed | Desktop Chrome / Edge | Firefox | Mac Safari |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Menu, customize, add to cart (cart badge bumps) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Pay by card; confirmation shows "Mahalo!" | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| 3-D Secure card: challenge appears, returns to the confirmation page **inside the app** | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Apple Pay (needs the domain verified in Stripe, Phase 11) | ☐ | ☐ | – | – | – | – | ☐ |
| Google Pay | – | – | ☐ | ☐ | ☐ | – | – |
| Tracker updates live; Ready banner, confetti, chime (after a tap) | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Ready notification with the app closed | n/a (install first) | ☐ (iOS 16.4+) | ☐ | ☐ | ☐ | ☐ | ☐ (macOS 13+) |
| Install offer after an order (dialog, or Share steps) | ☐ steps | – | ☐ dialog | – | ☐ dialog | – (no install) | – |
| Launch screen and icon look right | – | ☐ | – | ☐ | – | – | – |
| Offline: saved page + banner; checkout shows the offline page | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| New version prompt after a deploy | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| 200% zoom / large text: nothing cut off or sideways | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| VoiceOver / TalkBack: add a drink and reach Pay | ☐ | ☐ | ☐ | ☐ | – | – | ☐ |
| Staff screen on the counter tablet: Start shift keeps the screen on | ☐ | – | ☐ | – | ☐ | – | – |

Known differences:

- **iPhone, in Safari:** no install prompt (Share → Add to Home Screen); no
  notifications at all, so the order page explains how to get them; the Ready
  chime needs a tap first and the silent switch mutes it; Apple Pay shows.
- **iPhone, installed:** notifications on iOS 16.4+ once allowed; Safari may
  clear the app's saved pages if it isn't opened for a few weeks (storage
  limits), so the offline copy can be gone, never wrong; there is no browser
  bar, so the app's own back links are the way back.
- **Android Chrome:** the install dialog is offered after an order;
  notifications are always shown by the service worker (Android Chrome refuses
  them from the page) and arrive with the app closed. Google Pay shows on HTTPS.
- **Desktop Chrome/Edge:** installable from the address bar; notifications
  depend on the operating system's settings (Windows: System →
  Notifications).
- **Firefox (desktop and Android):** no install on desktop; service worker,
  offline and push all work.
- **Mac Safari:** Add to Dock (macOS 14+); push works (macOS 13+).

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
4. Run `npm run dev:lan` (plus `npm run stripe:listen` as above) and open
   `http://192.168.1.23:3000` on the phone.

Private-network addresses are already allowed in `next.config.ts`
(`allowedDevOrigins`). Over plain HTTP, Stripe's card form works in test mode,
but installing the app, notifications, Apple Pay and Google Pay all need
HTTPS; see below.

### Testing on a phone over HTTPS

For installing the app, "order ready" notifications and wallets, the phone
needs real HTTPS. Cloudflare's quick tunnels give the PC two temporary
`https://….trycloudflare.com` addresses with no account:

1. Once: `winget install --id Cloudflare.cloudflared`.
2. In two terminals (leave both running; each prints its address):

   ```powershell
   cloudflared tunnel --url http://127.0.0.1:54321   # Supabase
   cloudflared tunnel --url http://localhost:3000    # the app
   ```

3. In `.env.local`, set `NEXT_PUBLIC_SUPABASE_URL` to the Supabase tunnel's
   address and `NEXT_PUBLIC_SITE_URL` to the app tunnel's.
4. `npm run build`, then `npm run start` (and `npm run stripe:listen`). The
   build bakes those addresses in, and quick-tunnel addresses change every
   time, so rebuild after restarting a tunnel.
5. Open the app tunnel's address on the phone: install it ("Installing the
   app"), sign in, place an order, turn on notifications. Move the order to
   Ready from `/staff` on the PC (same address) and the notification arrives.

Afterwards put the two values back to `http://127.0.0.1:54321` and
`http://localhost:3000` (the e2e tests refuse to run otherwise) and rebuild.
Apple Pay needs the site's domain registered with Stripe, so it waits for the
real domain (Phase 11).

## Testing from outside Hawaii

The app always runs on Honolulu time (`Pacific/Honolulu`, UTC−10, no daylight
saving), whatever your computer's timezone. From Manila (UTC+8) Honolulu is
**18 hours behind**: 9:00 AM Monday in Manila is 3:00 PM Sunday in Honolulu,
and by mid-afternoon in Manila the cafe has closed for the night. The menu then
blocks Add to Cart, and checkout and the staff queue can't be tried.

For local testing, turn store hours off:

1. In `.env.local`, add `TEST_STORE_ALWAYS_OPEN=true`.
2. Restart `npm run dev` (env changes need a restart).
3. A yellow strip appears at the top of every page:
   *Test mode: store hours ignored · Honolulu time now: 5:43 PM Sun*.

While it is on, every location is open 24 hours, every day: weekly hours,
closures and holiday hours are ignored everywhere (header, menu, cart,
checkout, pickup slots, the payment webhook's re-check, the staff dashboard).
ASAP works at any hour and scheduled slots run every 15 minutes for the next
12 hours, past midnight. **Still enforced as normal:** the staff pause toggle,
the global online-ordering switch, sold-out items, and pop-up event windows.

**Local only.** The flag is honoured only on a development server
(`NODE_ENV` not `production`) whose `NEXT_PUBLIC_SUPABASE_URL` is
`127.0.0.1`, `localhost` or a private LAN address (phone testing). Anywhere
else, including a Vercel deployment where someone set it by mistake, it is
ignored and the server logs a warning. The e2e suite forces it off, so your
`.env.local` never changes test results. Set it back to `false` (or delete the
line) to see the real hours.

---

## Project layout

```
src/
  app/                 App Router pages, layouts, route handlers
    (auth)/            Sign-in, sign-up, forgot-password (shared layout)
    (shop)/            Customer app: header, bottom tab bar, pickup location
      (home)/          Home: points balance, active-order cards, favourites, order again
                       (route groups like this keep a list page's skeleton off the
                       detail pages below it; see ARCHITECTURE.md, "Real 404s")
      menu/            Menu, /menu/[slug] full page, @modal/(.)[slug] sheet
      account/         Profile, preferences, favourites, password, delete account
      cart/ checkout/  Cart (re-validated on the server) and checkout
      orders/          History (active + past), /orders/[id] live tracker
      orders/[id]/confirmed/  Confirmation, after Stripe's redirect
      rewards/         Overflow Rewards: balance, tiers, member QR, activity, how it works
    api/webhooks/stripe/     Stripe webhook (raw body, signature checked)
    api/cron/expire-orders/  Cancels unpaid checkouts (Vercel Cron)
    api/cron/expire-points/  Expires old points (off until the setting is turned on)
    api/cron/send-emails/    Delivers due emails from the outbox
    api/staff/orders/[id]/cancel/  Cancel-with-refund for staff (the dashboard calls it)
    api/push/subscriptions/  Saves / removes this device's push subscription
    serwist/[path]/    Builds and serves the service worker (src/sw/sw.ts)
    offline/           The offline page the service worker keeps
    manifest.ts robots.ts sitemap.ts  Web app manifest, robots.txt, sitemap.xml
    favicon.ico apple-icon.png opengraph-image.png twitter-image.png  From npm run brand:assets
    global-error.tsx   Last-resort error page; every route group also has
                       error.tsx, loading.tsx (skeletons) and not-found.tsx
    auth/callback/     Landing route for emailed confirmation / reset links
      catering/        Catering info and request form; [id]/pay pays a quote
      account/catering/  The customer's catering requests and one request's page
      events/          Live and upcoming pop-ups; [slug] for one
      collections/     A seasonal collection's page
      about/ privacy/ terms/ accessibility/  The admin's site content
    staff/             Barista dashboard (own plain frame, no customer tab bar)
    admin/             Admin: home (needs attention), menu (+ import), locations, settings,
                       setup, content, promos, rewards, orders, users, reports (+ CSV
                       exports), audit log; catering, events, collections
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
    staff/             Barista dashboard: queue, tickets, alerts, sold out, pause, printing
    admin/             Admin shell and building blocks: data table, form layout, confirm
                       dialog, image upload, Honolulu date/time, product picker,
                       sortable list, info tip; the editors for each admin section;
                       report charts
    catering/          Request form, quote summary, quote builder, timeline, pay page
    events/            Event card, Order for pickup here
    pwa/               Update prompt, offline banner, install offer
    ui/                shadcn/ui primitives
    skeletons.tsx      Loading skeletons for every route
    error-panel.tsx    The friendly error with Try again
    skip-link.tsx route-focus.tsx  Skip to content; focus moves to the page on navigation
    lazy-member.tsx    Signed-in-only parts of Home and Menu, loaded after first paint
    structured-data.tsx  JSON-LD (the cafe, with hours from the database)
    providers.tsx      The lazily loaded Toaster + PWA manager (TanStack Query is
                       per live island: src/lib/query-client.tsx)
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
    staff/             Queue columns and lateness, sold-out reset time, ticket layout
                       (pure, tested); counter access; dashboard reads and writes
    catering/          Status (mirrored from SQL), rules (lead time, deadline, ZIPs),
                       schemas, settings, queries, customer and admin actions, payments
    events/            Event windows and slugs (pure), queries, admin actions
    collections/       Contrast checks (pure), queries, admin actions
    admin/             Admin guard, attention queue, audit log reads, image uploads
    menu-admin/        Product and group editor rules + live preview (pure, tested), actions
    menu-import/       Spreadsheet import: columns, CSV/XLSX reading, checks, preview
    settings/          The typed settings registry (pure, tested), reads, save action
    content/ setup/    Site content (About, policies, logo) and the setup checklist
    reports/           Report definitions and CSV layouts (pure, tested), report reads
    csv.ts             Formula-safe CSV writer
    clock.ts           The request's "now" (the e2e test clock; test-clock.ts guards it)
    email/             EmailProvider (Resend / Mailpit), outbox sender, dev sweep
    push/              Web Push: VAPID config, delivery, outbox sender, subscriptions
    pwa/               Service worker caching rules, registration/update/install
                       helpers, offline page, iOS launch-screen list
    security/headers.ts  Content Security Policy and the other security headers
    seo/               Structured data, robots rules, sitemap reads
    log.ts             Server error logs: route, role, request id, personal data redacted
    toast.ts           Toasts that load the toaster only when first used
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
    env.ts             Public environment variables (browser-safe, no Zod)
    env.server.ts      Server-only, Zod-validated secrets
    money.ts           Integer-cent maths and USD formatting
    time.ts            Pacific/Honolulu helpers and pickup-slot generation
    order-status.ts    Order lifecycle, mirrored from SQL
    supabase/
      client.ts        Browser client (anon key, RLS applies)
      server.ts        Server Components / Actions / Route Handlers
      admin.ts         Service role — bypasses RLS, server only
      session.ts       Cookie refresh + /staff and /admin gating
  emails/              React Email templates: orders, catering, shared layout
  sw/sw.ts             The service worker (Serwist): caching, offline, push
  instrumentation.ts   Dev outbox sweep; logs server errors (onRequestError)
  types/database.ts    Generated database types
  proxy.ts             Next 16 proxy (formerly middleware): session, CSP nonce, request id
supabase/
  migrations/          Schema, RLS policies, triggers
  seed/seed.ts         Demo data
  tests/               pgTAP database tests (npm run test:db)
e2e/                   Playwright specs and their DB helpers (npm run test:e2e)
brand/logo.svg         The one source of every icon, splash screen and share image
scripts/brand-assets.ts  npm run brand:assets
scripts/push-keys.mjs  npm run push:keys (VAPID keys into .env.local)
scripts/lighthouse.mjs npm run lighthouse
scripts/test-db.mjs    Runs supabase/tests against the local database
scripts/stripe-*.mjs   npm run stripe:listen / stripe:doctor
scripts/seed-reports-demo.mjs  npm run db:seed:reports-demo (local only)
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
  milk option. Swapping in the real menu means changing rows (in the admin,
  or the menu import), never components.
- **The menu catalogue is cached for up to 60 seconds** (sold-out flags, hours
  and the pause toggle are always live). After `npm run db:seed`, restart
  `npm run dev` or wait a minute before the new menu shows.

---

## Still to confirm with the cafe

The admin tracks these at **Admin → Setup** (`/admin/setup`): each item with
its current value, a link to where it is edited, and a *Confirmed* tick once
the cafe has signed it off (Home shows the progress). In the code, grep for
`NEEDS_CONFIRMATION`. The open ones:

- [ ] Approved About / story copy from the current site (Admin → Content)
- [ ] Official brand hex values and confirmed font names (currently Baloo 2 + Inter)
- [ ] Logo (upload in Admin → Content; the typeset wordmark shows until then), and the logo mark for app icons, launch screens and share images (`brand/logo.svg`, then `npm run brand:assets`)
- [ ] Instagram handle, Facebook URL, contact email, phone number (Admin → Content)
- [ ] Real trading hours for each day
- [ ] Contact for push notifications (`VAPID_SUBJECT`, placeholder `mailto:notifications@drincup.test`; push services use it if something goes wrong)
- [ ] Accessibility statement wording and contact (Admin → Pages & contact; a draft is seeded)
- [ ] Error monitoring: which service, if any (proposal in ARCHITECTURE.md, "Monitoring")
- [ ] **GET rate** — seeded at 4.712% (Oʻahu visible pass-on rate)
- [ ] Whether GET is charged on tips (setting `tax.tips_taxed`, assumed no)
- [ ] Real menu, prices, sizes and modifier upcharges
- [ ] Whether flavours are charged once or per pump (seeded as once per flavour; `modifier_groups.charge_per_quantity`)
- [ ] Product photography (a generated brand-coloured placeholder shows until then)
- [ ] Pickup-shelf wording
- [ ] Whether catering delivery is offered (assumed yes), and where (`catering.delivery_zip_codes`, seeded with Oʻahu street-delivery ZIP codes)
- [ ] Catering minimum lead time (seeded at 72 hours)
- [ ] Catering payment deadline (48 hours before the event) and quote expiry (7 days)
- [ ] Catering default delivery fee ($25.00), and whether GET applies to it (assumed yes) and to a gratuity (assumed no)
- [ ] Where admin catering notifications go (`catering.admin_notification_email`, placeholder `catering@drincup.test`)
- [ ] Catering cancellation and refund policy (Admin → Content, placeholder wording; the admin picks full / partial / no refund each time)
- [ ] Full payment for catering, or a deposit (full payment for now; deposits are on the post-launch list)
- [ ] Ordering ahead while closed (setting `orders.order_ahead_while_closed`, off: the menu blocks adding while closed, though a cart already built can be scheduled for the next opening)
- [ ] Checkout timings: unpaid checkouts expire after 30 minutes; the ASAP estimate adds 2 minutes per order in the queue; 8 orders per 15-minute slot; last slot 15 minutes before closing
- [ ] Custom tip cap (seeded at $100 or 100% of the subtotal, whichever is lower)
- [ ] **Overflow Rewards** (all settings or `rewards` rows, so answers are data changes):
  - [ ] Earn rate (`loyalty.points_per_dollar`, seeded 1 point per $1, on the subtotal after discounts, before tax and tip)
  - [ ] Tiers and costs: 50 free add-on (flavor, topping or extra shot), 150 free drink up to $7.50, 250 for $12.50 off
  - [ ] Whether a free drink's cap covers add-ons (seeded no: size price up to the cap, add-ons charged; `rewards.covers_modifiers`)
  - [ ] Rewards per order (`loyalty.max_rewards_per_order`, seeded 1)
  - [ ] Promo code and reward on one order (`loyalty.allow_promo_with_reward`, seeded no)
  - [ ] Whether catering earns points (`loyalty.catering_earns_points`, seeded no)
  - [ ] Whether points expire (`loyalty.points_expire_after_months`, seeded 0 = never)
  - [ ] Programme name ("Overflow Rewards", `loyalty.program_name` and `BRAND`)

---

## Build phases

1. ✅ **Foundation** — setup, design tokens, migrations + RLS, seed
2. ✅ **Auth & roles** — sign-up/in/out, password reset, account page, account deletion, role-gated `/staff` and `/admin`
3. ✅ **Menu & customisation** — app shell, pickup locations and live status, menu, product sheet with data-driven modifiers, shared pricing engine, cart store
4. ✅ **Cart & checkout** — server-validated cart with edit in place, checkout with pickup slots, promos and tips, Stripe Payment + Express Checkout Elements, webhook-driven order placement, refunds, pending-order expiry
5. ✅ **Order tracking & history** — live tracker with Ready alerts, active-order cards and tab dot, history with pagination, reorder, favourites, email outbox (receipt, cancellation/refund, opt-in ready)
6. ✅ **Staff dashboard** — live queue with alerts and undo, tickets and printing, cancel with refund, sold out, pause with auto-resume, catering prep list
7. ✅ **Rewards** — points ledger with reservations, earning at pickup, refund reversals, data-driven reward tiers redeemed at checkout, rewards page with activity log, member QR, admin adjustments (data layer)
8. ✅ **Catering, events & seasonal collections** — catering requests, versioned quotes, payment with the Payment Element, changes and cancellations with refunds, emails and reminders, prep list; pop-up events with publishing and duplication; seasonal collections with limited-time products; image uploads; the admin shell; the reconcile fallback and Stripe tooling
9. ✅ **Admin dashboard** — audit log, needs-attention queue, menu editor with live preview and archive rules, spreadsheet import, locations and hours, typed settings with history, setup checklist and site content, promotions, rewards, orders with refunds, users and roles, reports with CSV exports
10. ✅ **Polish** — installable app with offline page and update prompt, order-ready push notifications, WCAG 2.1 AA pass with axe in e2e, loading/error/empty states, strict nonce CSP and security headers, SEO and share images, Lighthouse 90+ on mobile, request-id error logging
11. ⬜ Testing & deploy

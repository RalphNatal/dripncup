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

> Docker Desktop is not currently installed on this machine. Install it from
> <https://www.docker.com/products/docker-desktop/>, start it, and make sure
> the whale icon says "Engine running" before continuing.

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
| `RESEND_API_KEY` | **secret** | Phase 5 | Transactional email |
| `EMAIL_FROM` | config | Phase 5 | Verified sender address |

`.env*` is gitignored. Never commit real keys — `.env.example` is the template.

`src/lib/env.ts` validates all of these with Zod at startup, so a missing variable fails immediately with a readable message instead of a confusing runtime error later.

---

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Next dev server (Turbopack) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run test:watch` | Vitest in watch mode |
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

Locally, confirmation and password-reset emails never leave your machine. Open
Mailpit at <http://127.0.0.1:54324> to read them and click the links. The local
stack allows only two auth emails per hour (`[auth.rate_limit]` in
`config.toml`).

---

## Testing Stripe webhooks locally (Phase 4)

Install the [Stripe CLI](https://docs.stripe.com/stripe-cli), then in a second
PowerShell window:

```powershell
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

`stripe listen` prints a signing secret (`whsec_...`). Put it in `.env.local` as
`STRIPE_WEBHOOK_SECRET` and restart `npm run dev`.

Trigger a test event:

```powershell
stripe trigger payment_intent.succeeded
```

Orders only become **Placed** once the webhook confirms payment, so the listener
must be running for checkout to complete end to end.

---

## Project layout

```
src/
  app/                 App Router pages, layouts, route handlers
    (auth)/            Sign-in, sign-up, forgot-password (shared layout)
    auth/callback/     Landing route for emailed confirmation / reset links
    account/           Profile, preferences, change password
  components/
    account/           Profile form
    auth/              Auth forms, shared form fields, sign-out, account link
    brand/             Logo, decorative marks
    ui/                shadcn/ui primitives
    providers.tsx      TanStack Query + Tooltip + Toaster
  lib/
    auth/
      actions.ts       Sign-in/up/out and password Server Actions
      dal.ts           getCurrentProfile, requireProfile, requireRole
      roles.ts         Which roles may open which routes
      schemas.ts       Zod schemas for every auth/account form
      redirect.ts      safeNextPath -- blocks open redirects via ?next=
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
  types/database.ts    Generated database types
  proxy.ts             Next 16 proxy (formerly middleware)
supabase/
  migrations/          Schema, RLS policies, triggers
  seed/seed.ts         Demo data
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
  milk option.

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
- [ ] Pickup-shelf wording
- [ ] Whether catering delivery is offered (assumed yes)
- [ ] Catering minimum lead time (seeded at 72 hours)

---

## Build phases

1. ✅ **Foundation** — setup, design tokens, migrations + RLS, seed
2. ✅ **Auth & roles** — sign-up/in/out, password reset, account page, role-gated `/staff` and `/admin`
3. ⬜ Menu & customisation
4. ⬜ Cart & checkout (Stripe)
5. ⬜ Order tracking & history
6. ⬜ Staff dashboard
7. ⬜ Rewards
8. ⬜ Catering, events & seasonal collections
9. ⬜ Admin dashboard
10. ⬜ Polish (PWA, a11y, performance)
11. ⬜ Testing & deploy

/**
 * Removes data that automated tests left in the local dev database.
 * `npm run db:clean-test-data [-- --yes]`
 *
 * Since the e2e suite moved to its own stack (scripts/e2e.mjs), tests no
 * longer write to the dev database; this clears what earlier runs left and
 * anything a test run pointed at the wrong database might leave in future.
 *
 * What counts as test data (seed data and hand-testing data never match):
 *   - auth users e2e-*@drincup.test (every account the suites create, and
 *     the e2e stack's own e2e-admin/-barista/-customer) and race@drincup.test
 *     (the points_race fixture), with everything they own
 *   - orders owned by those users, and anonymised orders whose idempotency
 *     key starts "e2e-" (made by the suite, owner since deleted); with their
 *     lines, payments, refunds, status history, email outbox rows, reward
 *     snapshots, promo redemptions and points reservations
 *   - catering requests owned by or addressed to those users
 *   - webhook events delivered by the suite (evt_e2e_*), and real Stripe
 *     events whose PaymentIntent belongs to a test order (looked up in the
 *     Stripe sandbox)
 *   - their rate-limit counters, roster rows, favourites and points ledger
 *   - sold-out flags and pauses set by those users; availability-log rows
 *     written by them, or with no actor or a seeded staff/admin actor while
 *     a test run was going on (the suite flipped flags with the service role
 *     and the seeded barista)
 *   - Mailpit messages addressed to those users
 * Then: promo usage counts lose the removed redemptions, and today's order
 * and catering counters drop back to the highest number still in use.
 *
 * Integrity rules stay on. Everything runs in one transaction; foreign keys
 * and the ledger's append-only trigger work as usual (the ledger allows
 * deletes, and its balance trigger keeps the cached balances exact). The one
 * exception is `order_items_freeze`, which makes a paid order's lines
 * undeletable: it is disabled by name for this transaction only, under the
 * ACCESS EXCLUSIVE lock ALTER TABLE takes, so no other session can write
 * order lines meanwhile, and re-enabled before commit. That runs as the
 * table owner through `docker exec` into the local database container,
 * which exists only on this machine; there is no database function a hosted
 * project could ever call.
 *
 * Refuses unless NEXT_PUBLIC_SUPABASE_URL (.env.local) is a loopback URL.
 * Prints what it will remove and asks first; --yes skips the question.
 */
import { createInterface } from "node:readline/promises";

import Stripe from "stripe";

import { containerRunning, databaseContainer, isLoopbackUrl, psql, psqlJson, readEnvFile } from "./lib/local-stack.mjs";

const YES = process.argv.includes("--yes") || process.argv.includes("-y");
const env = { ...readEnvFile(".env"), ...readEnvFile(".env.local"), ...process.env };

const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !isLoopbackUrl(url)) {
  console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL is ${url ? `"${url}"` : "not set"}, not a local (127.0.0.1 / localhost) database.`);
  process.exit(1);
}
const container = databaseContainer();
if (!containerRunning(container)) {
  console.error(`The local database container "${container}" is not running. Start it with npm run db:start.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The rules, as temp tables. Shared by the preview and the clean-up itself, so
// what is shown is exactly what is removed.
// ---------------------------------------------------------------------------

const TEST_EMAIL = String.raw`^(e2e-.*|race)@drincup\.test$`;

/** `extraEvents`: real Stripe event ids found to belong to test orders. */
function selectionSql(extraEvents) {
  const events = extraEvents.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ") || "null";
  return `
    create temp table t_users on commit drop as
      select id, email, created_at from auth.users where email ~* '${TEST_EMAIL}';

    create temp table t_orders on commit drop as
      select id, order_number, created_at, updated_at from public.orders
       where user_id in (select id from t_users)
          or (user_id is null and idempotency_key like 'e2e-%');

    create temp table t_catering on commit drop as
      select id, request_number from public.catering_requests
       where user_id in (select id from t_users) or contact_email ~* '${TEST_EMAIL}';

    -- Moments tests were writing: each test account's creation and each test
    -- order's creation and last change. Tests make an account per test, so
    -- these cover a run with gaps of minutes, not hours.
    create temp table t_moments on commit drop as
      select created_at as at from t_users
      union select created_at from t_orders
      union select updated_at from t_orders;

    create temp table t_seeded_staff on commit drop as
      select id from public.profiles where email in ('admin@drincup.test', 'barista@drincup.test');

    create temp table t_log on commit drop as
      select l.id from public.location_availability_log l
       where l.actor in (select id from t_users)
          or ((l.actor is null or l.actor in (select id from t_seeded_staff))
              and exists (select 1 from t_moments m
                           where l.created_at between m.at - interval '5 minutes' and m.at + interval '15 minutes'));

    create temp table t_events on commit drop as
      select id from public.webhook_events where id like 'evt_e2e_%' or id in (${events});
  `;
}

/** Daily counters ahead of the highest number still in use that day. */
const COUNTERS_AHEAD_SQL = `
  select scope, counter_day, last_value, in_use from (
    select c.scope, c.counter_day, c.last_value,
           coalesce(case c.scope
             when 'order' then (select max(split_part(order_number, '-', 3)::int) from public.orders
                                 where split_part(order_number, '-', 2) = to_char(c.counter_day, 'YYMMDD'))
             when 'catering' then (select max(split_part(request_number, '-', 3)::int) from public.catering_requests
                                    where split_part(request_number, '-', 2) = to_char(c.counter_day, 'YYMMDD'))
           end, 0) as in_use
      from public.daily_counters c
     where c.scope in ('order', 'catering')) x
   where last_value > in_use`;

const PREVIEW_SQL = `
  begin;
  ${selectionSql([])}
  select json_build_object(
    'users', (select count(*) from t_users),
    'orders', (select coalesce(json_agg(order_number order by order_number), '[]') from t_orders),
    'payment_intents', (select coalesce(json_agg(provider_payment_intent_id), '[]') from public.payments
                         where order_id in (select id from t_orders) and provider_payment_intent_id is not null),
    'catering', (select coalesce(json_agg(request_number), '[]') from t_catering),
    'log_rows', (select count(*) from t_log),
    'real_events', (select coalesce(json_agg(id), '[]') from public.webhook_events where id not like 'evt_e2e_%'),
    'counters_ahead', (select count(*) from (${COUNTERS_AHEAD_SQL}) c)
  );
  rollback;
`;

function cleanSql(extraEvents) {
  return `
  begin;
  ${selectionSql(extraEvents)}

  create temp table t_report (item text, n bigint) on commit drop;
  insert into t_report values
    ('test accounts', (select count(*) from t_users)),
    ('orders', (select count(*) from t_orders)),
    ('order lines', (select count(*) from public.order_items where order_id in (select id from t_orders))),
    ('status history rows', (select count(*) from public.order_status_history where order_id in (select id from t_orders))),
    ('payments', (select count(*) from public.payments where order_id in (select id from t_orders))),
    ('refunds', (select count(*) from public.refunds where order_id in (select id from t_orders))),
    ('email outbox rows', (select count(*) from public.email_outbox where order_id in (select id from t_orders))),
    ('reward snapshots', (select count(*) from public.order_rewards where order_id in (select id from t_orders))),
    ('promo redemptions', (select count(*) from public.promo_redemptions where order_id in (select id from t_orders))),
    ('points reservations', (select count(*) from public.loyalty_reservations
                              where order_id in (select id from t_orders) or user_id in (select id from t_users))),
    ('points ledger rows', (select count(*) from public.loyalty_transactions
                             where user_id in (select id from t_users))),
    ('favourites', (select count(*) from public.favorites where user_id in (select id from t_users))),
    ('catering requests', (select count(*) from t_catering)),
    ('staff roster rows', (select count(*) from public.staff_locations where profile_id in (select id from t_users))),
    ('sold-out flags set by tests', (select count(*) from public.location_availability where updated_by in (select id from t_users))),
    ('pauses set by tests', (select count(*) from public.locations where paused_by in (select id from t_users) and not accepting_orders)),
    ('availability log rows', (select count(*) from t_log)),
    ('webhook events', (select count(*) from t_events)),
    ('rate-limit counters', (select count(*) from public.rate_limit_hits
                              where split_part(key, ':user:', 2) in (select id::text from t_users)));

  -- Promo usage counts only paid redemptions; take the test ones back off.
  update public.promos p
     set times_used = greatest(0, p.times_used - r.n)
    from (select promo_id, count(*) as n from public.promo_redemptions
           where order_id in (select id from t_orders) group by promo_id) r
   where p.id = r.promo_id;

  -- Storefront state tests left on.
  update public.locations
     set accepting_orders = true, paused_until = null, paused_at = null, paused_by = null
   where paused_by in (select id from t_users);
  delete from public.location_availability where updated_by in (select id from t_users);
  delete from public.location_availability_log where id in (select id from t_log);

  -- Paid orders' lines are frozen; lift that one trigger for this
  -- transaction (ALTER TABLE holds an exclusive lock on order_items until
  -- commit) and put it straight back.
  alter table public.order_items disable trigger order_items_freeze;
  delete from public.orders where id in (select id from t_orders);
  alter table public.order_items enable trigger order_items_freeze;

  delete from public.catering_requests where id in (select id from t_catering);
  delete from public.webhook_events where id in (select id from t_events);
  delete from public.rate_limit_hits where split_part(key, ':user:', 2) in (select id::text from t_users);
  -- Cascades to profiles, favourites, roster rows, the points ledger and reservations.
  delete from auth.users where id in (select id from t_users);

  insert into t_report
    select 'order/catering counters wound back', count(*) from (${COUNTERS_AHEAD_SQL}) c;
  -- The next order or catering request takes the number after the highest
  -- one still in use that day. (Tests also take numbers for rows they delete
  -- themselves, e.g. the account-deletion test and points_race.)
  update public.daily_counters c
     set last_value = a.in_use
    from (${COUNTERS_AHEAD_SQL}) a
   where c.scope = a.scope and c.counter_day = a.counter_day;

  select json_agg(json_build_object('item', item, 'n', n)) from t_report;
  commit;
  `;
}

// ---------------------------------------------------------------------------
// Real Stripe events (relayed by the suite, or forwarded by `stripe listen`)
// carry no marker of their own; ask the sandbox which PaymentIntent each is
// about.
// ---------------------------------------------------------------------------

async function realEventsForTestPayments(eventIds, testIntents) {
  if (!eventIds.length) return { ids: [], note: null };
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key || !/^(sk|rk)_test_/.test(key)) {
    return { ids: [], note: "no Stripe test key in .env.local, so real Stripe webhook events were left alone" };
  }
  const stripe = new Stripe(key, { maxNetworkRetries: 2 });
  const intents = new Set(testIntents);
  const ids = [];
  try {
    for (const id of eventIds) {
      const event = await stripe.events.retrieve(id).catch(() => null);
      const object = event?.data.object;
      if (!object) continue;
      const intent =
        object.object === "payment_intent" ? object.id : typeof object.payment_intent === "string" ? object.payment_intent : null;
      if (intent && (intents.has(intent) || object.metadata?.source === "e2e")) ids.push(id);
    }
  } catch (error) {
    return { ids, note: `Stripe lookup stopped early (${error.message})` };
  }
  return { ids, note: null };
}

// ---------------------------------------------------------------------------
// Mailpit (the local inbox the dev email provider sends to).
// ---------------------------------------------------------------------------

async function cleanMailpit(apply) {
  const base = env.MAILPIT_URL ?? "http://127.0.0.1:54324";
  if (!isLoopbackUrl(base)) return { count: 0, note: `MAILPIT_URL ${base} is not local; skipped` };
  try {
    const ids = [];
    for (let start = 0; ; start += 500) {
      const response = await fetch(`${base}/api/v1/messages?limit=500&start=${start}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const page = await response.json();
      for (const message of page.messages ?? []) {
        if ((message.To ?? []).some((to) => new RegExp(TEST_EMAIL, "i").test(to.Address ?? ""))) ids.push(message.ID);
      }
      if (start + 500 >= (page.messages_count ?? page.total ?? 0)) break;
    }
    if (apply && ids.length) {
      const response = await fetch(`${base}/api/v1/messages`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ IDs: ids }),
      });
      if (!response.ok) throw new Error(`delete: HTTP ${response.status}`);
    }
    return { count: ids.length, note: null };
  } catch (error) {
    return { count: 0, note: `Mailpit at ${base} not reachable (${error.message}); skipped` };
  }
}

// ---------------------------------------------------------------------------

const preview = psqlJson(container, PREVIEW_SQL);
const stripeEvents = await realEventsForTestPayments(preview.real_events, preview.payment_intents);
const mail = await cleanMailpit(false);

console.log(`Local database: ${container} (${url})\n`);
if (
  !preview.users &&
  !preview.orders.length &&
  !preview.catering.length &&
  !preview.counters_ahead &&
  !stripeEvents.ids.length &&
  !mail.count
) {
  console.log("No test data found. Nothing to do.");
  process.exit(0);
}
console.log("Will remove:");
console.log(`  ${preview.users} test accounts (e2e-*@drincup.test, race@drincup.test) and everything they own`);
console.log(`  ${preview.orders.length} test orders${preview.orders.length ? `: ${summariseNumbers(preview.orders)}` : ""}`);
if (preview.catering.length) console.log(`  ${preview.catering.length} catering requests: ${preview.catering.join(", ")}`);
console.log(`  ${preview.log_rows} sold-out log rows written by tests, or by the service role or seeded staff while tests ran`);
console.log(`  webhook events: the suite's own, plus ${stripeEvents.ids.length} real Stripe events for test payments`);
console.log(`  ${mail.count} Mailpit messages to test accounts`);
console.log("  and wind today's order/catering counters back to the highest number still in use");
for (const note of [stripeEvents.note, mail.note].filter(Boolean)) console.log(`  (note: ${note})`);
console.log("\nKept: the seed data and the accounts admin@, barista@ and customer@drincup.test with everything they own.");

if (!YES) {
  if (!process.stdin.isTTY) {
    console.error("\nNot a terminal, so cannot ask. Re-run with --yes to go ahead.");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nRemove this test data? [y/N] ");
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log("Nothing removed.");
    process.exit(0);
  }
}

const result = psql(container, cleanSql(stripeEvents.ids));
if (result.error || result.status !== 0) {
  console.error(`\nClean-up failed and was rolled back; nothing was removed.\n${result.error?.message ?? result.stderr.trim()}`);
  process.exit(1);
}
const report = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
const mailRemoved = await cleanMailpit(true);

console.log("\nRemoved:");
for (const { item, n } of report) if (Number(n) > 0) console.log(`  ${String(n).padStart(5)}  ${item}`);
if (mailRemoved.count) console.log(`  ${String(mailRemoved.count).padStart(5)}  Mailpit messages`);
console.log("\nDone. Promo usage counts and today's order/catering counters were corrected to match.");


/** DC-261004-0006 … DC-261004-0070 → "DC-261004-0006 … DC-261004-0070" (first and last, sorted). */
function summariseNumbers(numbers) {
  return numbers.length <= 4 ? numbers.join(", ") : `${numbers[0]} … ${numbers.at(-1)}`;
}

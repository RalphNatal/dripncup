/**
 * Concurrent checkouts cannot spend the same points.
 *
 * pgTAP runs in one transaction, so it cannot show two customers' checkouts
 * racing. This does, with real database sessions (separate psql processes):
 *
 *   1. Session A starts a checkout that reserves all 150 points and keeps its
 *      transaction open; session B tries to spend the same 150 meanwhile.
 *      B must wait for A's lock on the profile row, then fail with DC004.
 *   2. Five sessions at once, 300 points, 150 each: exactly two succeed.
 *
 * Fixtures are committed (other sessions must see them) and removed again
 * before and after. Run by `npm run test:db`.
 */
const USER = "c8000000-0000-0000-0000-000000000001";
const LOCATION = "18000000-0000-0000-0000-000000000001";
const PRODUCT = "28000000-0000-0000-0000-000000000001";
const REWARD = "38000000-0000-0000-0000-000000000001";

// Lines first: the freeze trigger only lets a pending order's lines go, and
// it cannot see the order once a cascade has deleted it. (These orders are
// never paid, so they are all still pending.)
const CLEANUP = `
  delete from public.order_items where order_id in (select id from public.orders where user_id = '${USER}');
  delete from public.orders where user_id = '${USER}';
  delete from public.loyalty_transactions where user_id = '${USER}';
  delete from auth.users where id = '${USER}';
  delete from public.rewards where id = '${REWARD}';
  delete from public.products where id = '${PRODUCT}';
  delete from public.locations where id = '${LOCATION}';
`;

const SETUP = `
  insert into auth.users (id, email, raw_user_meta_data) values ('${USER}', 'race@drincup.test', '{"full_name": "Race Test"}');
  insert into public.locations (id, type, name, slug) values ('${LOCATION}', 'cafe', 'Race Test Cafe', 'race-test-cafe');
  insert into public.products (id, name, slug, base_price_cents) values ('${PRODUCT}', 'Race Latte', 'race-latte', 750);
  insert into public.rewards (id, name, type, points_cost, value_cents) values ('${REWARD}', 'Free drink', 'free_item', 150, 750);
`;

/** The call createCheckout makes: a $7.50 latte, free with 150 points. */
function checkoutSql(key) {
  const item = `md5('race-item-${key}')::uuid`;
  return `
    select order_id from public.create_checkout_order(
      jsonb_build_object(
        'user_id', '${USER}', 'location_id', '${LOCATION}', 'pickup_type', 'asap',
        'estimated_ready_at', now() + interval '10 minutes',
        'subtotal_cents', 750, 'discount_cents', 750, 'reward_discount_cents', 750, 'taxable_base_cents', 0,
        'tax_rate', 0, 'tax_cents', 0, 'tip_cents', 0, 'total_cents', 0,
        'points_redeemed', 150, 'customer_first_name', 'Race',
        'idempotency_key', '${key}', 'checkout_fingerprint', '${key}'
      ),
      jsonb_build_array(jsonb_build_object(
        'id', ${item}, 'product_id', '${PRODUCT}', 'product_name', 'Race Latte', 'modifiers', '[]'::jsonb,
        'base_price_cents', 750, 'unit_price_cents', 750, 'quantity', 1, 'line_total_cents', 750, 'special_instructions', ''
      )),
      jsonb_build_array(jsonb_build_object(
        'reward_id', '${REWARD}', 'reward_name', 'Free drink', 'reward_type', 'free_item',
        'points_cost', 150, 'discount_cents', 750, 'order_item_id', ${item}
      ))
    );`;
}

const STATE = `
  select (select loyalty_points from public.profiles where id = '${USER}')
    || ' ' || (select count(*) from public.loyalty_reservations where user_id = '${USER}')
    || ' ' || (select count(*) from public.orders where user_id = '${USER}');`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function run({ psql }) {
  const results = [];
  const check = (ok, name, detail) => results.push({ ok, name, detail });

  const prepare = async (points) => {
    await psql(CLEANUP);
    const setup = await psql(`${SETUP} select public.admin_adjust_points('${USER}', ${points}, 'Concurrency test');`);
    if (setup.status !== 0) throw new Error(`setup failed: ${setup.stderr}`);
  };

  try {
    // 1. A holds its transaction open; B tries meanwhile.
    await prepare(150);
    const stamp = Date.now();
    const a = psql(`begin; ${checkoutSql(`race-a-${stamp}`)} select pg_sleep(2); commit;`);
    await sleep(600);
    const bStarted = Date.now();
    const b = await psql(`\\set VERBOSITY verbose\n${checkoutSql(`race-b-${stamp}`)}`);
    const bWaited = Date.now() - bStarted;
    const aResult = await a;

    check(aResult.status === 0, "session A reserves the points", aResult.stderr);
    check(b.status !== 0 && /DC004/.test(b.stderr), "session B is refused with DC004 (not enough points)", b.stderr || b.stdout);
    check(bWaited >= 1000, `session B waited for A's lock first (${bWaited} ms)`, `waited ${bWaited} ms`);
    const after = (await psql(STATE)).stdout.trim();
    check(after === "0 1 1", "one reservation, one order, balance 0", `balance / reservations / orders = ${after}`);

    // 2. A burst of five for two rewards' worth of points.
    await prepare(300);
    const burst = await Promise.all(
      Array.from({ length: 5 }, (_, i) => psql(`\\set VERBOSITY verbose\n${checkoutSql(`race-burst-${stamp}-${i}`)}`)),
    );
    const won = burst.filter((r) => r.status === 0).length;
    const refused = burst.filter((r) => r.status !== 0 && /DC004/.test(r.stderr)).length;
    check(won === 2 && refused === 3, `five at once with points for two: ${won} succeed, ${refused} refused`, burst.map((r) => r.stderr.trim()).join(" | "));
    const final = (await psql(STATE)).stdout.trim();
    check(final === "0 2 2", "two reservations, two orders, balance 0", `balance / reservations / orders = ${final}`);
  } finally {
    await psql(CLEANUP);
  }

  return results;
}

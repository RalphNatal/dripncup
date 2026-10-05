/**
 * Helpers shared by the scripts that work on a local Supabase stack's
 * database directly: `npm run test:db`, `npm run test:e2e` (scripts/e2e.mjs)
 * and `npm run db:clean-test-data`.
 *
 * SQL goes through `docker exec ... psql` into the stack's database
 * container, so these only ever reach a database running on this machine.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/** The local stack names its containers after `project_id` in its config.toml. */
export function projectIdOf(configPath = "supabase/config.toml") {
  const config = readFileSync(configPath, "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (!projectId) throw new Error(`Could not read project_id from ${configPath}`);
  return projectId;
}

export function databaseContainer(projectId = projectIdOf()) {
  return `supabase_db_${projectId}`;
}

export function containerRunning(name) {
  const result = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() === "true";
}

const PSQL_ARGS = ["psql", "-U", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];

/** Runs SQL in the container; returns spawnSync's result (status, stdout, stderr). */
export function psql(container, sql) {
  return spawnSync("docker", ["exec", "-i", container, ...PSQL_ARGS], { input: sql, encoding: "utf8" });
}

/** Runs one statement returning a single json value and parses it; throws on error. */
export function psqlJson(container, sql) {
  const result = psql(container, sql);
  if (result.error || result.status !== 0) {
    throw new Error(`psql in ${container} failed: ${result.error?.message ?? result.stderr.trim()}`);
  }
  return JSON.parse(result.stdout.trim());
}

/** KEY=value lines (quotes optional), as dotenv files and `supabase status -o env` print them. */
export function parseEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  }
  return env;
}

export function readEnvFile(path) {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

/** True for a Supabase URL on this machine (loopback only). */
export function isLoopbackUrl(url) {
  try {
    return ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Fingerprint: everything an e2e run could change, in one query. Taken before
// and after `npm run test:e2e` to prove the dev database was not touched.
// ---------------------------------------------------------------------------

const COUNTED_TABLES = [
  "auth.users",
  "public.orders",
  "public.order_items",
  "public.order_status_history",
  "public.order_rewards",
  "public.payments",
  "public.refunds",
  "public.email_outbox",
  "public.webhook_events",
  "public.loyalty_transactions",
  "public.loyalty_reservations",
  "public.promo_redemptions",
  "public.favorites",
  "public.catering_requests",
  "public.staff_locations",
  "public.location_availability_log",
];

/** Rows whose content matters, not just their number (hashed). */
const HASHED = {
  "pause / event windows": "select id, accepting_orders, paused_until, paused_by, starts_at, ends_at from public.locations",
  "opening hours": "select location_id, day_of_week, opens_at, closes_at from public.location_hours",
  closures: "select location_id, closure_date, is_closed, opens_at, closes_at from public.closures",
  "sold-out flags": "select location_id, product_id, modifier_option_id, is_available, available_from from public.location_availability",
  settings: "select key, value from public.settings",
  "menu prices": "select id, base_price_cents, is_active from public.products",
  "promo usage": "select id, times_used from public.promos",
  "points balances": "select id, loyalty_points, role from public.profiles",
  "daily counters": "select scope, counter_day, last_value from public.daily_counters",
};

export const FINGERPRINT_SQL = `select json_build_object(${[
  ...COUNTED_TABLES.map((table) => `'${table.replace(/^public\./, "")}', (select count(*) from ${table})`),
  ...Object.entries(HASHED).map(
    ([label, query]) => `'${label}', (select coalesce(md5(string_agg(t::text, '|' order by t::text)), 'empty') from (${query}) t)`,
  ),
].join(", ")});`;

export function fingerprint(container) {
  return psqlJson(container, FINGERPRINT_SQL);
}

/** The keys whose values differ between two fingerprints. */
export function fingerprintChanges(before, after) {
  return Object.keys(before).filter((key) => before[key] !== after[key]);
}

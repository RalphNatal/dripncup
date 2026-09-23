/**
 * Runs the pgTAP suites in supabase/tests against the local database.
 *
 * `supabase test db` does the same job, but it bind-mounts the tests folder
 * into a pg_prove container, and Docker Desktop on Windows intermittently
 * fails that mount ("mkdir /run/desktop/mnt/host/c: file exists"). Piping each
 * file into psql inside the already-running database container needs no mount,
 * so it works wherever `npm run db:start` does.
 *
 * Each suite wraps itself in BEGIN ... ROLLBACK, so nothing it creates
 * survives the run.
 *
 * Usage: npm run test:db [-- path/to/one.test.sql]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TESTS_DIR = "supabase/tests";

/** The local stack names its containers after `project_id` in config.toml. */
function databaseContainer() {
  if (process.env.SUPABASE_DB_CONTAINER) return process.env.SUPABASE_DB_CONTAINER;
  const config = readFileSync("supabase/config.toml", "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (!projectId) throw new Error("Could not read project_id from supabase/config.toml");
  return `supabase_db_${projectId}`;
}

function psql(container, sql) {
  return spawnSync(
    "docker",
    ["exec", "-i", container, "psql", "-U", "postgres", "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  );
}

const container = databaseContainer();
const requested = process.argv.slice(2);
const files = requested.length
  ? requested
  : readdirSync(TESTS_DIR)
      .filter((name) => name.endsWith(".test.sql"))
      .sort()
      .map((name) => join(TESTS_DIR, name));

const setup = psql(container, "create extension if not exists pgtap with schema extensions;");
if (setup.error || setup.status !== 0) {
  console.error(
    `Could not reach the database container "${container}". Is the local stack running (npm run db:start)?\n` +
      (setup.error?.message ?? setup.stderr),
  );
  process.exit(1);
}

let failedSuites = 0;
let totalTests = 0;

for (const file of files) {
  const result = psql(container, readFileSync(file, "utf8"));
  const lines = result.stdout.split(/\r?\n/).filter(Boolean);

  const planned = Number(lines.find((line) => /^1\.\.\d+$/.test(line))?.slice(3) ?? NaN);
  const passed = lines.filter((line) => /^ok \d+/.test(line)).length;
  const failures = lines.filter((line) => /^not ok \d+/.test(line));
  const ranAll = Number.isFinite(planned) && passed + failures.length === planned;
  const ok = result.status === 0 && failures.length === 0 && ranAll;

  totalTests += passed + failures.length;
  console.log(`${ok ? "PASS" : "FAIL"}  ${file}  (${passed}/${Number.isFinite(planned) ? planned : "?"})`);

  if (!ok) {
    failedSuites += 1;
    // Show each failure with the diagnostics pgTAP prints beneath it.
    for (const line of lines) {
      if (/^not ok/.test(line) || line.startsWith("#")) console.log(`      ${line}`);
    }
    if (result.stderr.trim()) console.log(`      ${result.stderr.trim().replace(/\n/g, "\n      ")}`);
    if (!ranAll && result.status === 0) {
      console.log(`      planned ${planned} tests but ran ${passed + failures.length}`);
    }
  }
}

console.log(`\n${files.length - failedSuites}/${files.length} suites passed, ${totalTests} assertions.`);
process.exit(failedSuites === 0 ? 0 : 1);

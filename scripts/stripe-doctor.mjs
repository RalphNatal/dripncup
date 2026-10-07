/**
 * `npm run stripe:doctor`: checks the local Stripe setup end to end and
 * says what to fix. Prints no secrets (only whether each is set, its mode,
 * and the account id, which is not secret).
 *
 *   1. the three keys in .env.local are set and in test mode
 *   2. the secret key works, and names the account
 *   3. the publishable key belongs to the same account (a token made with
 *      it is looked up with the secret key)
 *   4. the Stripe CLI is installed
 *   5. STRIPE_WEBHOOK_SECRET is the one `stripe listen` signs with for this
 *      account on this machine
 *   6. the dev server's webhook route answers (a bad signature gets a 400)
 *
 * Exits 1 if anything is wrong. Usage: npm run stripe:doctor [-- --port 3000]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

import { STRIPE_WEBHOOK_EVENTS, WEBHOOK_PATH } from "./lib/stripe-events.mjs";

const env = { ...(existsSync(".env") ? parse(readFileSync(".env")) : {}), ...(existsSync(".env.local") ? parse(readFileSync(".env.local")) : {}) };
const get = (name) => (env[name] ?? "").trim();
const portArg = process.argv.indexOf("--port");
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 3000;

let failed = false;
const ok = (message) => console.log(`  ✓ ${message}`);
const warn = (message) => console.log(`  ! ${message}`);
const bad = (message, fix) => {
  failed = true;
  console.log(`  ✗ ${message}${fix ? `\n      → ${fix}` : ""}`);
};

console.log("Stripe setup check\n");

// 1. Keys.
if (!existsSync(".env.local")) bad(".env.local not found", "Copy .env.example to .env.local and fill it in (README, \"Payments (Stripe)\").");
const secret = get("STRIPE_SECRET_KEY");
const publishable = get("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
const webhookSecret = get("STRIPE_WEBHOOK_SECRET");

if (!secret) bad("STRIPE_SECRET_KEY is not set", "Dashboard (sandbox) → Developers → API keys → Secret key.");
else if (!/^(sk|rk)_test_/.test(secret)) bad("STRIPE_SECRET_KEY is not a test-mode key", "Use the sandbox's sk_test_… key; live keys are never used locally.");
else ok("STRIPE_SECRET_KEY is set (test mode)");

if (!publishable) bad("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set", "Dashboard (sandbox) → Developers → API keys → Publishable key.");
else if (!publishable.startsWith("pk_test_")) bad("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not a test-mode key", "Use the sandbox's pk_test_… key.");
else ok("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set (test mode)");

if (!webhookSecret) bad("STRIPE_WEBHOOK_SECRET is not set", "Run `npm run stripe:listen`, copy the whsec_… it prints into .env.local, restart `npm run dev`.");
else if (!webhookSecret.startsWith("whsec_")) bad("STRIPE_WEBHOOK_SECRET does not look like a webhook secret (whsec_…)");
else ok("STRIPE_WEBHOOK_SECRET is set");

async function stripeApi(path, key, init = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// 2-3. The keys work, and belong together.
let accountId = null;
if (/^(sk|rk)_test_/.test(secret)) {
  try {
    const account = await stripeApi("account", secret);
    if (account.status === 200) {
      accountId = account.body.id;
      const name = account.body.settings?.dashboard?.display_name || account.body.business_profile?.name;
      ok(`The secret key works: account ${accountId}${name ? ` (${name})` : ""}`);
    } else {
      bad(`Stripe refused the secret key (${account.status}: ${account.body.error?.message ?? "unknown"})`, "Copy the key again from the sandbox's API keys page.");
    }
  } catch (error) {
    bad(`Could not reach Stripe (${error.message})`, "Check your internet connection.");
  }
}

if (accountId && publishable.startsWith("pk_test_")) {
  try {
    const token = await stripeApi("tokens", publishable, { method: "POST", body: "pii[id_number]=000000000" });
    if (token.status !== 200) {
      bad(`Stripe refused the publishable key (${token.status}: ${token.body.error?.message ?? "unknown"})`, "Copy the publishable key again.");
    } else {
      const lookup = await stripeApi(`tokens/${token.body.id}`, secret);
      if (lookup.status === 200) ok("The publishable key belongs to the same account");
      else bad("The publishable key belongs to a different Stripe account than the secret key", "Copy both keys from the same sandbox.");
    }
  } catch (error) {
    bad(`Could not check the publishable key (${error.message})`);
  }
}

// 4-5. The CLI and the webhook secret it signs with.
const version = spawnSync("stripe", ["version"], { encoding: "utf8" });
if (version.error || version.status !== 0) {
  bad("The Stripe CLI is not installed or not on PATH", "winget install Stripe.StripeCLI, then open a new terminal.");
} else {
  ok(`Stripe CLI ${version.stdout.match(/\d+\.\d+\.\d+/)?.[0] ?? "installed"}`);
  if (accountId && webhookSecret) {
    const printed = spawnSync("stripe", ["listen", "--print-secret"], { encoding: "utf8", env: { ...process.env, STRIPE_API_KEY: secret }, timeout: 30_000 });
    const cliSecret = printed.stdout?.trim();
    if (printed.status !== 0 || !cliSecret?.startsWith("whsec_")) {
      warn("Could not ask the Stripe CLI for its webhook secret; skipping that check.");
    } else if (cliSecret === webhookSecret) {
      ok("STRIPE_WEBHOOK_SECRET matches what `npm run stripe:listen` signs with");
    } else {
      bad("STRIPE_WEBHOOK_SECRET is not the secret `stripe listen` uses for this account", "Run `npm run stripe:listen`, copy the whsec_… it prints into .env.local, restart `npm run dev`.");
    }
  }
}

// 6. The dev server's webhook route.
try {
  const response = await fetch(`http://localhost:${port}${WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "stripe-signature": "t=0,v1=doctor", "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 400) ok(`The dev server's webhook route answers on port ${port} (and rejects a bad signature)`);
  else if (response.status === 500) bad(`The webhook route on port ${port} answered 500`, "Check the dev server's terminal: usually STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is missing there (restart `npm run dev` after editing .env.local).");
  else warn(`The webhook route on port ${port} answered ${response.status}`);
} catch {
  warn(`No dev server on port ${port}; start \`npm run dev\` to check the webhook route.`);
}

console.log(`\nEvents forwarded by \`npm run stripe:listen\` (and needed on a production endpoint):\n  ${STRIPE_WEBHOOK_EVENTS.join(", ")}`);
console.log(failed ? "\nSomething needs fixing (✗ above)." : "\nAll good.");
process.exit(failed ? 1 : 0);

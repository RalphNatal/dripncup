/**
 * `npm run stripe:listen [-- --port 3000]`: forwards the sandbox's webhook
 * events to the local dev server, exactly the events the app handles
 * (scripts/lib/stripe-events.mjs).
 *
 * The key comes from .env.local (STRIPE_SECRET_KEY) and is handed to the
 * Stripe CLI in its STRIPE_API_KEY environment variable, never on the
 * command line, so the CLI listens to the same account the app pays in
 * (a plain `stripe login` may point at another). Live keys are refused.
 *
 * The CLI prints the webhook signing secret (whsec_…) when it starts. It is
 * the same every time for this account and machine; put it in .env.local as
 * STRIPE_WEBHOOK_SECRET once. `npm run stripe:doctor` checks it matches.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

import { STRIPE_WEBHOOK_EVENTS, WEBHOOK_PATH } from "./lib/stripe-events.mjs";

const env = { ...(existsSync(".env") ? parse(readFileSync(".env")) : {}), ...(existsSync(".env.local") ? parse(readFileSync(".env.local")) : {}) };
const key = (process.env.STRIPE_SECRET_KEY ?? env.STRIPE_SECRET_KEY ?? "").trim();

if (!key) {
  console.error("STRIPE_SECRET_KEY is not set in .env.local. See README, \"Payments (Stripe)\".");
  process.exit(1);
}
if (!/^(sk|rk)_test_/.test(key)) {
  console.error("Refusing to forward webhooks for a live Stripe key. Use the sandbox's test key (sk_test_…).");
  process.exit(1);
}

const portArg = process.argv.indexOf("--port");
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 3000;
if (!Number.isInteger(port) || port <= 0) {
  console.error("Usage: npm run stripe:listen [-- --port 3000]");
  process.exit(1);
}

const forwardTo = `localhost:${port}${WEBHOOK_PATH}`;
console.log(`Forwarding ${STRIPE_WEBHOOK_EVENTS.join(", ")}\n  to ${forwardTo}\n  (Stripe account from STRIPE_SECRET_KEY in .env.local). Ctrl+C to stop.\n`);

const child = spawn("stripe", ["listen", "--events", STRIPE_WEBHOOK_EVENTS.join(","), "--forward-to", forwardTo], {
  stdio: "inherit",
  env: { ...process.env, STRIPE_API_KEY: key },
});
child.on("error", (error) => {
  console.error(
    error.code === "ENOENT"
      ? "The Stripe CLI is not installed or not on PATH. Install it (winget install Stripe.StripeCLI) and open a new terminal."
      : `Could not start the Stripe CLI: ${error.message}`,
  );
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));

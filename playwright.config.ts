/**
 * End-to-end tests. `npm run test:e2e`.
 *
 * Runs against its own Supabase stack, never the dev database:
 * scripts/e2e.mjs (`npm run test:e2e`) starts a second local stack from
 * .e2e-stack/ (ports 553xx), resets and seeds it with e2e-only accounts,
 * runs Playwright, then checks the dev database is exactly as it was.
 * `npx playwright test` on its own reuses that stack as the last run left
 * it, and fails if it has never been set up (e2e/support/stack.ts).
 *
 * The suite builds the app and serves the production build on port 3100, so
 * it never collides with `npm run dev` on 3000.
 *
 * Tests share one database and flip real rows in it (sold-out flags, the pause
 * toggle), so they run one at a time.
 */
import { defineConfig, devices } from "@playwright/test";

import { e2eStackEnv } from "./e2e/support/stack";

const PORT = 3100;

// Everything below -- the test server, the service-role helpers, signed-in
// clients and the Mailpit inbox -- talks to the e2e stack. Set on
// process.env so test workers (which inherit it) and the web server see it,
// ahead of anything in .env.local.
const stack = e2eStackEnv();
Object.assign(process.env, stack);

// Tags the run's Stripe PaymentIntents and refunds (metadata source=e2e,
// e2e_run=<id>; description prefixed "[e2e]") so the sandbox dashboard tells
// them apart from hand testing.
process.env.E2E_RUN_ID ??= `e2e-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}`;

// The order-expiry route only answers with its secret; the test server gets a
// fixed one, and the tests read it back from here.
process.env.E2E_CRON_SECRET ??= "e2e-local-cron-secret";

/**
 * Which browser build to drive. On Windows this defaults to the Microsoft Edge
 * that ships with the OS, so no browser download is needed; elsewhere it uses
 * Playwright's bundled Chromium (`npx playwright install chromium`).
 * Override with PLAYWRIGHT_CHANNEL=chromium | chrome | msedge.
 */
const envChannel = process.env.PLAYWRIGHT_CHANNEL;
const channel =
  envChannel === "chromium"
    ? undefined
    : (envChannel ?? (process.platform === "win32" ? "msedge" : undefined));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Phone first, matching the design: 390px-class viewport, touch, mobile UA.
    { name: "mobile", use: { ...devices["Pixel 7"], channel }, grepInvert: /@desktop|@tablet/ },
    // The centred product dialog and top navigation only exist at desktop widths.
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel }, grep: /@desktop/ },
    // The staff dashboard is designed for a landscape counter tablet: four queue columns side by side.
    {
      name: "tablet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, hasTouch: true, channel },
      grep: /@tablet/,
    },
  ],
  webServer: {
    // The menu catalogue is cached in .next/cache and outlives a rebuild;
    // clearing it means a freshly re-seeded database is what the tests see.
    command: `node -e "require('fs').rmSync('.next/cache/fetch-cache',{recursive:true,force:true})" && npm run build && npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // TEST_STORE_ALWAYS_OPEN is forced off, whatever .env.local says: the
    // suite controls opening hours itself (e2e/support/storefront.ts), and the
    // open/closed tests must see the real rules. (A production build ignores
    // the flag anyway; this keeps it true even if that guard ever changed.)
    //
    // RESEND_API_KEY is blanked so emails go to the e2e stack's Mailpit.
    env: {
      ...stack,
      CRON_SECRET: process.env.E2E_CRON_SECRET,
      TEST_STORE_ALWAYS_OPEN: "false",
      RESEND_API_KEY: "",
      E2E_RUN_ID: process.env.E2E_RUN_ID,
    },
    // Never reuse a server already on the port: one left over from an older
    // run may have been built against the dev database.
    reuseExistingServer: false,
    timeout: 300_000,
  },
});

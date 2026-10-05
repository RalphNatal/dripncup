/**
 * Runs once when a Next.js server starts.
 *
 * Decides local test mode (TEST_STORE_ALWAYS_OPEN) up front, so a flag the
 * guard refuses is reported in the server log at start, production included.
 * In development it also starts the email outbox sweep (see
 * src/lib/email/dev-sweep.ts). Nothing happens on the edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { storeAlwaysOpen } = await import("./lib/test-mode");
  if (storeAlwaysOpen()) console.info("Test mode: TEST_STORE_ALWAYS_OPEN is on. Store hours and closures are ignored.");

  if (process.env.NODE_ENV !== "development") return;
  const { startDevOutboxSweep } = await import("./lib/email/dev-sweep");
  startDevOutboxSweep();
}

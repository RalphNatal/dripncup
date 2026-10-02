/**
 * Runs once when a Next.js server starts.
 *
 * In development it starts the email outbox sweep (see
 * src/lib/email/dev-sweep.ts). Nothing happens in production or on the edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "development") return;
  const { startDevOutboxSweep } = await import("./lib/email/dev-sweep");
  startDevOutboxSweep();
}

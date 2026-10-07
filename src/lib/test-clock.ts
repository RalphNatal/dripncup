/**
 * The e2e suite's controllable clock.
 *
 * End-to-end tests need "the day of the event" or "after the collection
 * ends" without waiting days. The suite sets a cookie, `dc_test_clock`,
 * holding an offset in milliseconds; the server's request-scoped clock
 * (`appNow()` in ./clock.ts) adds it. Each browser context has its own
 * cookie, so a test's clock never leaks into another's.
 *
 * Honoured only when BOTH hold:
 *   - `E2E_RUN_ID` is set: only the Playwright test server has it
 *     (playwright.config.ts), never `npm run dev`, never Vercel; and
 *   - `NEXT_PUBLIC_SUPABASE_URL` is this machine or the private LAN.
 * A production deploy talks to a hosted database, so it cannot pass the
 * second test even if the first were set by mistake. The e2e server is a
 * production build (NODE_ENV=production), which is why NODE_ENV is not the
 * guard here, unlike TEST_STORE_ALWAYS_OPEN.
 *
 * The database keeps its own clock (now()): every rule it enforces still
 * uses real time. The clock moves only what the server decides in
 * TypeScript: which events are live, which collections and limited-time
 * products are showing, the staff prep list's day, catering deadlines shown
 * and checked before the database is asked.
 */
import { isLocalSupabaseUrl } from "./test-mode";

export const TEST_CLOCK_COOKIE = "dc_test_clock";

/** Offsets further than this are refused (a typo, not a test). */
const MAX_OFFSET_MS = 400 * 24 * 60 * 60 * 1000;

export function testClockAllowed(env: { E2E_RUN_ID?: string; NEXT_PUBLIC_SUPABASE_URL?: string }): boolean {
  return Boolean(env.E2E_RUN_ID?.trim()) && isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
}

/** The cookie's offset in ms, or 0 for anything that is not a sane whole number. */
export function parseTestClockOffset(value: string | undefined): number {
  if (!value || !/^-?\d{1,13}$/.test(value.trim())) return 0;
  const offset = Number(value.trim());
  return Number.isSafeInteger(offset) && Math.abs(offset) <= MAX_OFFSET_MS ? offset : 0;
}

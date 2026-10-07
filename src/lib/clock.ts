import "server-only";

/**
 * "Now" for a request. Real time, except on the e2e test server, where a
 * test may shift it with a cookie (see ./test-clock.ts for the guard).
 * Outside a request (instrumentation, cron routes) it is always real time.
 */
import { cookies } from "next/headers";

import { TEST_CLOCK_COOKIE, parseTestClockOffset, testClockAllowed } from "./test-clock";

const allowed = testClockAllowed({
  E2E_RUN_ID: process.env.E2E_RUN_ID,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
});

export async function appNow(): Promise<Date> {
  if (!allowed) return new Date();
  try {
    const offset = parseTestClockOffset((await cookies()).get(TEST_CLOCK_COOKIE)?.value);
    return new Date(Date.now() + offset);
  } catch {
    // Not in a request.
    return new Date();
  }
}

/**
 * appNow() minus real time, to the second: 0 except under the e2e test clock.
 * For client components that must agree with the server about "today".
 */
export async function appClockOffsetMs(): Promise<number> {
  if (!allowed) return 0;
  const real = Date.now();
  return Math.round(((await appNow()).getTime() - real) / 1000) * 1000;
}

import { describe, expect, it } from "vitest";

import { parseTestClockOffset, testClockAllowed } from "./test-clock";

describe("the e2e test clock guard", () => {
  it("is honoured only on the e2e server against a local database", () => {
    expect(testClockAllowed({ E2E_RUN_ID: "e2e-20261006", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321" })).toBe(true);
  });

  it("is refused without E2E_RUN_ID (npm run dev, Vercel)", () => {
    expect(testClockAllowed({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(false);
    expect(testClockAllowed({ E2E_RUN_ID: "  ", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })).toBe(false);
  });

  it("is refused against a hosted database even with E2E_RUN_ID set", () => {
    expect(testClockAllowed({ E2E_RUN_ID: "e2e-x", NEXT_PUBLIC_SUPABASE_URL: "https://abcd.supabase.co" })).toBe(false);
    expect(testClockAllowed({ E2E_RUN_ID: "e2e-x" })).toBe(false);
  });

  it("reads a whole-millisecond offset and ignores anything else", () => {
    expect(parseTestClockOffset("86400000")).toBe(86_400_000);
    expect(parseTestClockOffset("-3600000")).toBe(-3_600_000);
    expect(parseTestClockOffset("1e9")).toBe(0);
    expect(parseTestClockOffset("2026-10-06")).toBe(0);
    expect(parseTestClockOffset(undefined)).toBe(0);
    // More than 400 days is a typo, not a test.
    expect(parseTestClockOffset(String(500 * 24 * 60 * 60 * 1000))).toBe(0);
  });
});

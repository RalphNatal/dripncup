import { describe, expect, it } from "vitest";

import { isLocalSupabaseUrl, resolveStoreAlwaysOpen } from "./test-mode";

const LOCAL = "http://127.0.0.1:54321";

describe("the TEST_STORE_ALWAYS_OPEN guard", () => {
  it("applies in development against the local Supabase stack", () => {
    expect(
      resolveStoreAlwaysOpen({ TEST_STORE_ALWAYS_OPEN: "true", NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: LOCAL }),
    ).toEqual({ active: true });
  });

  it("is off, silently, when the flag is unset or false", () => {
    for (const value of [undefined, "", "false", "0", "yes"]) {
      expect(
        resolveStoreAlwaysOpen({ TEST_STORE_ALWAYS_OPEN: value, NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: LOCAL }),
      ).toEqual({ active: false, warning: null });
    }
  });

  it("is ignored, with a warning, in a production build even against a local database", () => {
    const decision = resolveStoreAlwaysOpen({
      TEST_STORE_ALWAYS_OPEN: "true",
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: LOCAL,
    });
    expect(decision.active).toBe(false);
    expect(decision).toMatchObject({ warning: expect.stringMatching(/production build/) });
  });

  it("is ignored, with a warning, against a hosted Supabase project", () => {
    const decision = resolveStoreAlwaysOpen({
      TEST_STORE_ALWAYS_OPEN: "true",
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
    });
    expect(decision.active).toBe(false);
    expect(decision).toMatchObject({ warning: expect.stringMatching(/not a local address/) });
  });

  it("is ignored when the Supabase URL is missing", () => {
    expect(resolveStoreAlwaysOpen({ TEST_STORE_ALWAYS_OPEN: "true", NODE_ENV: "development" }).active).toBe(false);
  });

  it("is ignored on a production build pointed at a hosted project (the Vercel case)", () => {
    expect(
      resolveStoreAlwaysOpen({
        TEST_STORE_ALWAYS_OPEN: "true",
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
      }).active,
    ).toBe(false);
  });
});

describe("what counts as a local Supabase URL", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://[::1]:54321",
    "http://192.168.1.23:54321",
    "http://10.0.0.5:54321",
    "http://172.16.0.9:54321",
    "http://172.31.255.1:54321",
  ])("%s is local", (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(true);
  });

  it.each([
    "https://abcdefghijklmnop.supabase.co",
    "https://db.example.com",
    "http://172.32.0.1:54321",
    "http://8.8.8.8:54321",
    "http://localhost.example.com",
    "http://127.0.0.1.nip.io",
    "not a url",
    "",
  ])("%s is not local", (url) => {
    expect(isLocalSupabaseUrl(url)).toBe(false);
  });
});

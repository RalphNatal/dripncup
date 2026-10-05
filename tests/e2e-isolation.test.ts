/**
 * The e2e suite must never depend on, or change, the accounts kept for hand
 * testing (admin@, barista@ and customer@drincup.test). It has its own,
 * e2e-admin@ and friends, seeded into its own stack (scripts/e2e.mjs).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : /\.(ts|mjs|js)$/.test(entry.name) ? [path] : [];
  });
}

const HAND_TESTING_ACCOUNT = /(?<![\w.-])(admin|barista|customer)@drincup\.test/g;

describe("e2e isolation", () => {
  it("no e2e file names a hand-testing account", () => {
    const offenders = [...filesUnder("e2e"), "playwright.config.ts"].flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(HAND_TESTING_ACCOUNT)].map((match) => `${file}: ${match[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it("the Playwright server is never reused (it may point at another database)", () => {
    expect(readFileSync("playwright.config.ts", "utf8")).toMatch(/reuseExistingServer:\s*false/);
  });
});

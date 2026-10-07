import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CATERING_STATUSES, CATERING_TRANSITIONS, cateringProgressIndex, isValidCateringTransition } from "./status";

describe("catering status transitions", () => {
  it("walks submitted -> quoted -> confirmed -> fulfilled", () => {
    expect(isValidCateringTransition("submitted", "quoted")).toBe(true);
    expect(isValidCateringTransition("quoted", "confirmed")).toBe(true);
    expect(isValidCateringTransition("confirmed", "fulfilled")).toBe(true);
  });

  it("sends a quote back to submitted when the customer asks for changes", () => {
    expect(isValidCateringTransition("quoted", "submitted")).toBe(true);
  });

  it("cancels from any state before fulfilled, never after", () => {
    for (const status of ["submitted", "quoted", "confirmed"] as const) {
      expect(isValidCateringTransition(status, "cancelled")).toBe(true);
    }
    expect(isValidCateringTransition("fulfilled", "cancelled")).toBe(false);
  });

  it("never skips payment or comes back from the end", () => {
    expect(isValidCateringTransition("submitted", "confirmed")).toBe(false);
    expect(isValidCateringTransition("quoted", "fulfilled")).toBe(false);
    expect(CATERING_TRANSITIONS.fulfilled).toHaveLength(0);
    expect(CATERING_TRANSITIONS.cancelled).toHaveLength(0);
  });

  it("numbers the customer-facing steps", () => {
    expect(cateringProgressIndex("submitted")).toBe(0);
    expect(cateringProgressIndex("fulfilled")).toBe(3);
    expect(cateringProgressIndex("cancelled")).toBe(-1);
  });
});

/** The latest migration defining is_valid_catering_transition is the enforcing copy. */
describe("parity with the SQL enforcement", () => {
  function parseSqlTransitions(): Record<string, string[]> {
    const dir = join(process.cwd(), "supabase/migrations");
    const marker = "create or replace function public.is_valid_catering_transition";
    const file = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .reverse()
      .find((f) => readFileSync(join(dir, f), "utf8").includes(marker));
    expect(file, "is_valid_catering_transition not found in any migration").toBeDefined();

    const sql = readFileSync(join(dir, file!), "utf8");
    const start = sql.indexOf(marker);
    const body = sql.slice(start, sql.indexOf("$$;", start));
    const parsed: Record<string, string[]> = {};
    for (const match of body.matchAll(/when\s+'(\w+)'\s+then\s+to_status\s+in\s*\(([^)]*)\)/g)) {
      parsed[match[1]] = [...match[2].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    }
    for (const match of body.matchAll(/when\s+'(\w+)'\s+then\s+false/g)) parsed[match[1]] = [];
    return parsed;
  }

  it("matches CATERING_TRANSITIONS exactly, for every status", () => {
    const sorted = (map: Record<string, readonly string[]>) =>
      Object.fromEntries(Object.entries(map).map(([from, to]) => [from, [...to].sort()]));
    expect(sorted(parseSqlTransitions())).toEqual(sorted(CATERING_TRANSITIONS));
    expect(CATERING_STATUSES).toHaveLength(5);
  });
});

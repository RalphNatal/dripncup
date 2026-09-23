import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVE_ORDER_STATUSES,
  ORDER_TRANSITIONS,
  isTerminalStatus,
  isValidOrderTransition,
  progressIndex,
  type OrderStatus,
} from "./order-status";

describe("order status transitions", () => {
  it("does not let an order skip the queue", () => {
    expect(isValidOrderTransition("placed", "picked_up")).toBe(false);
    expect(isValidOrderTransition("pending_payment", "ready")).toBe(false);
    expect(isValidOrderTransition("accepted", "ready")).toBe(false);
  });

  it("walks the happy path one step at a time", () => {
    expect(isValidOrderTransition("pending_payment", "placed")).toBe(true);
    expect(isValidOrderTransition("placed", "accepted")).toBe(true);
    expect(isValidOrderTransition("accepted", "preparing")).toBe(true);
    expect(isValidOrderTransition("preparing", "ready")).toBe(true);
    expect(isValidOrderTransition("ready", "picked_up")).toBe(true);
  });

  it("allows cancellation any time before pickup, and never after", () => {
    for (const status of ["pending_payment", "placed", "accepted", "preparing", "ready"] as const) {
      expect(isValidOrderTransition(status, "cancelled")).toBe(true);
    }
    expect(isValidOrderTransition("picked_up", "cancelled")).toBe(false);
  });

  it("treats refunded as the end of the line", () => {
    expect(ORDER_TRANSITIONS.refunded).toHaveLength(0);
    expect(isValidOrderTransition("refunded", "placed")).toBe(false);
  });

  it("never moves backwards", () => {
    expect(isValidOrderTransition("ready", "preparing")).toBe(false);
    expect(isValidOrderTransition("accepted", "placed")).toBe(false);
  });
});

describe("progressIndex", () => {
  it("orders the customer-facing steps", () => {
    expect(progressIndex("placed")).toBe(0);
    expect(progressIndex("picked_up")).toBe(4);
  });

  it("returns -1 for states that are not on the happy path", () => {
    expect(progressIndex("cancelled")).toBe(-1);
    expect(progressIndex("pending_payment")).toBe(-1);
  });
});

describe("queue helpers", () => {
  it("counts only unfinished orders as active", () => {
    expect(ACTIVE_ORDER_STATUSES).not.toContain("picked_up");
    expect(ACTIVE_ORDER_STATUSES).not.toContain("pending_payment");
  });

  it("marks finished orders terminal", () => {
    expect(isTerminalStatus("picked_up")).toBe(true);
    expect(isTerminalStatus("refunded")).toBe(true);
    expect(isTerminalStatus("preparing")).toBe(false);
  });
});

/**
 * The database is the enforcing copy of this rule. If the two drift, the UI
 * would offer a button the server rejects -- so parse the migration and compare
 * it against the TypeScript map directly.
 */
describe("parity with the SQL enforcement", () => {
  function parseSqlTransitions(): Record<string, string[]> {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260101000015_business_rules.sql"),
      "utf8",
    );

    const fnStart = sql.indexOf("create or replace function public.is_valid_order_transition");
    expect(fnStart, "is_valid_order_transition not found in the migration").toBeGreaterThan(-1);

    const body = sql.slice(fnStart, sql.indexOf("$$;", fnStart));

    const parsed: Record<string, string[]> = {};

    // when 'placed' then to_status in ('accepted', 'cancelled')
    for (const match of body.matchAll(
      /when\s+'(\w+)'\s+then\s+to_status\s+in\s*\(([^)]*)\)/g,
    )) {
      const [, from, list] = match;
      parsed[from] = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    }

    // when 'refunded' then false
    for (const match of body.matchAll(/when\s+'(\w+)'\s+then\s+false/g)) {
      parsed[match[1]] = [];
    }

    return parsed;
  }

  it("matches ORDER_TRANSITIONS exactly", () => {
    const sqlTransitions = parseSqlTransitions();

    const expected = Object.fromEntries(
      Object.entries(ORDER_TRANSITIONS).map(([from, to]) => [from, [...to].sort()]),
    );
    const actual = Object.fromEntries(
      Object.entries(sqlTransitions).map(([from, to]) => [from, [...to].sort()]),
    );

    expect(actual).toEqual(expected);
  });

  it("covers every status in the enum", () => {
    const statuses = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];
    expect(statuses).toHaveLength(8);
    expect(Object.keys(parseSqlTransitions()).sort()).toEqual([...statuses].sort());
  });
});

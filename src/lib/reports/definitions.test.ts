import { describe, expect, it } from "vitest";

import { parseCsv, toCsv } from "@/lib/csv";

import {
  activeHours,
  addDaysToKey,
  averageOrderValue,
  fillDays,
  ordersCsvRows,
  parseReportRange,
  peakGrid,
  presetRange,
  salesCsvRows,
  splitRefund,
  sumSales,
  type OrderExportRow,
  type SalesDay,
} from "./definitions";

/** 11:30 PM HST on Thursday 2026-03-05 (09:30 UTC on the 6th). */
const LATE_THURSDAY = new Date("2026-03-06T09:30:00Z");

describe("date presets (Honolulu)", () => {
  it("use the Honolulu date, not UTC's", () => {
    expect(presetRange("today", LATE_THURSDAY)).toEqual({ preset: "today", from: "2026-03-05", to: "2026-03-05" });
    expect(presetRange("yesterday", LATE_THURSDAY)).toEqual({ preset: "yesterday", from: "2026-03-04", to: "2026-03-04" });
    expect(presetRange("last7", LATE_THURSDAY)).toEqual({ preset: "last7", from: "2026-02-27", to: "2026-03-05" });
    expect(presetRange("this_month", LATE_THURSDAY)).toEqual({ preset: "this_month", from: "2026-03-01", to: "2026-03-05" });
    expect(presetRange("last_month", LATE_THURSDAY)).toEqual({ preset: "last_month", from: "2026-02-01", to: "2026-02-28" });
  });

  it("handle January's last month and leap years", () => {
    expect(presetRange("last_month", new Date("2026-01-15T22:00:00Z"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetRange("last_month", new Date("2028-03-02T22:00:00Z"))).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("parse custom ranges, refusing bad ones", () => {
    expect(parseReportRange({ preset: "custom", from: "2026-02-01", to: "2026-02-10" }, LATE_THURSDAY)).toEqual({
      range: { preset: "custom", from: "2026-02-01", to: "2026-02-10" },
      problem: null,
    });
    expect(parseReportRange({ preset: "custom", from: "2026-02-10", to: "2026-02-01" }, LATE_THURSDAY).problem).toMatch(/on or before/);
    expect(parseReportRange({ preset: "custom", from: "2026-02-30", to: "2026-03-01" }, LATE_THURSDAY).problem).toMatch(/Pick both/);
    expect(parseReportRange({ preset: "custom", from: "2023-01-01", to: "2026-03-01" }, LATE_THURSDAY).problem).toMatch(/two years/);
    expect(parseReportRange({}, LATE_THURSDAY).range).toMatchObject({ preset: "last7", from: "2026-02-27" });
  });

  it("does calendar arithmetic on date keys", () => {
    expect(addDaysToKey("2026-03-31", 1)).toBe("2026-04-01");
    expect(addDaysToKey("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("splitRefund (same cases as supabase/tests/admin.test.sql)", () => {
  it("takes back exactly what a fully refunded order added", () => {
    expect(splitRefund({ totalCents: 1122, taxCents: 42, tipCents: 180 }, 1122)).toEqual({ refunded: 1122, tax: 42, tip: 180, sales: 900 });
  });

  it("splits a partial refund in the order's proportions, sales taking the remainder", () => {
    // 500 of 1571 (tax 71): 500 * 71 / 1571 = 22.6 -> 23.
    expect(splitRefund({ totalCents: 1571, taxCents: 71, tipCents: 0 }, 500)).toEqual({ refunded: 500, tax: 23, tip: 0, sales: 477 });
  });

  it("never splits more than was refunded, nor more than the order", () => {
    for (const refunded of [0, 1, 2, 3, 50, 99, 100]) {
      const s = splitRefund({ totalCents: 100, taxCents: 50, tipCents: 49 }, refunded);
      expect(s.sales).toBeGreaterThanOrEqual(0);
      expect(s.sales + s.tax + s.tip).toBe(refunded);
    }
    expect(splitRefund({ totalCents: 100, taxCents: 5, tipCents: 0 }, 250).refunded).toBe(100);
    expect(splitRefund({ totalCents: 0, taxCents: 0, tipCents: 0 }, 0)).toEqual({ refunded: 0, tax: 0, tip: 0, sales: 0 });
  });
});

/** Fixed data: three orders over two days, as the SQL would sum them. */
const DAYS: SalesDay[] = [
  {
    businessDate: "2026-03-09", orders: 1, grossSalesCents: 1000, promoDiscountCents: 100, rewardDiscountCents: 0,
    refundedCents: 1122, refundedSalesCents: 900, netSalesCents: 0, taxCents: 0, tipCents: 0, netBeforeRefundsCents: 900,
    collectedCents: 1122,
  },
  {
    businessDate: "2026-03-10", orders: 2, grossSalesCents: 2800, promoDiscountCents: 0, rewardDiscountCents: 500,
    refundedCents: 500, refundedSalesCents: 477, netSalesCents: 1823, taxCents: 86, tipCents: 100, netBeforeRefundsCents: 2300,
    collectedCents: 2509,
  },
];

describe("totals", () => {
  it("sum every column, and the average order value is per order before refunds", () => {
    const totals = sumSales(DAYS);
    expect(totals).toMatchObject({
      orders: 3, grossSalesCents: 3800, promoDiscountCents: 100, rewardDiscountCents: 500, refundedCents: 1622,
      netSalesCents: 1823, taxCents: 86, tipCents: 100, netBeforeRefundsCents: 3200, collectedCents: 3631,
    });
    expect(totals.averageOrderValueCents).toBe(1067);
    // net sales + tax + tips = collected - refunded
    expect(totals.netSalesCents + totals.taxCents + totals.tipCents).toBe(totals.collectedCents - totals.refundedCents);
  });

  it("an empty range averages to zero", () => {
    expect(averageOrderValue(0, 0)).toBe(0);
    expect(sumSales([]).averageOrderValueCents).toBe(0);
  });

  it("fill the days nothing was sold, for the chart", () => {
    const filled = fillDays({ from: "2026-03-08", to: "2026-03-11" }, DAYS);
    expect(filled.map((d) => [d.businessDate, d.orders])).toEqual([
      ["2026-03-08", 0], ["2026-03-09", 1], ["2026-03-10", 2], ["2026-03-11", 0],
    ]);
  });
});

describe("peak hours", () => {
  it("build a weekday x hour grid", () => {
    const { grid, max } = peakGrid([
      { weekday: 1, hour: 7, orders: 4 },
      { weekday: 1, hour: 8, orders: 9 },
      { weekday: 6, hour: 21, orders: 2 },
      { weekday: 9, hour: 1, orders: 99 },
    ]);
    expect(grid[1][8]).toBe(9);
    expect(max).toBe(9);
    expect(activeHours(grid)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
  });
});

describe("CSV exports", () => {
  it("the sales export ends with a total row that matches the days", () => {
    const rows = parseCsv(toCsv(salesCsvRows(DAYS)));
    expect(rows[0][0]).toBe("Date");
    expect(rows.at(-1)).toEqual(["Total", "3", "38", "1", "5", "16.22", "18.23", "0.86", "1", "10.67", "36.31"]);
  });

  it("the orders export adds up to the sales export", () => {
    const order = (over: Partial<OrderExportRow>): OrderExportRow => ({
      orderNumber: "DC-1", businessDate: "2026-03-10", placedAt: "2026-03-10T22:00:00Z", locationName: "Cafe", status: "picked_up",
      customerFirstName: "=cmd|' /C calc'!A0", itemCount: 1, grossSalesCents: 0, promoDiscountCents: 0, rewardDiscountCents: 0,
      netBeforeRefundsCents: 0, taxCents: 0, tipCents: 0, totalCents: 0, refundedCents: 0, refundedSalesCents: 0, refundedTaxCents: 0,
      refundedTipCents: 0, netSalesCents: 0, netTaxCents: 0, netTipCents: 0, promoCode: null, rewards: null, pointsEarned: 0,
      pointsRedeemed: 0, paymentMethod: "Visa 4242", ...over,
    });
    const rows = [
      order({ grossSalesCents: 2000, netSalesCents: 1023, refundedCents: 500, netTaxCents: 48 }),
      order({ grossSalesCents: 800, netSalesCents: 800, netTaxCents: 38, netTipCents: 100 }),
    ];
    const csv = parseCsv(toCsv(ordersCsvRows(rows, (iso) => iso)));
    const column = (name: string) => csv[0].indexOf(name);
    const sum = (name: string) => csv.slice(1).reduce((s, r) => s + Number(r[column(name)]), 0);
    expect(sum("Net sales")).toBeCloseTo(DAYS[1].netSalesCents / 100);
    expect(sum("Gross sales")).toBeCloseTo(DAYS[1].grossSalesCents / 100);
    // A customer name that would be a formula is defused.
    expect(csv[1][column("Customer")]).toBe("'=cmd|' /C calc'!A0");
  });
});

/**
 * Report definitions: what each number means, the date presets, and the
 * shaping the screens and CSV exports need. Pure, so the rules can be tested
 * on fixed data.
 *
 * The numbers themselves are aggregated in SQL
 * (20260101000029_admin_reports.sql, built on report_order_facts), never by
 * loading orders into the browser. `splitRefund` mirrors the SQL's refund
 * split with the same examples, so the two can be checked against each other.
 */
import { csvDollars, type CsvCell } from "@/lib/csv";
import { cafeDateKey } from "@/lib/time";

// ---------------------------------------------------------------------------
// Definitions, as the info tooltips and ARCHITECTURE.md word them.
// ---------------------------------------------------------------------------

export const REPORT_DEFINITIONS = {
  counted:
    "Paid orders: every order that was placed (paid, or paid in full with a reward), including ones cancelled or refunded later. Unpaid and abandoned checkouts never count.",
  day: "The Honolulu date the order was placed.",
  gross: "Item prices with add-ons, before any discount. Tax and tips are not sales.",
  promo: "Money taken off by promo codes.",
  reward: "Money taken off by Overflow Rewards.",
  refunds:
    "Money given back, on the day of the order it belongs to (whenever the refund happened), so a day always describes the same orders and the orders export adds up to it. A refund made today can change an earlier day. Each refund is split across sales, tax and tip in the order's own proportions.",
  net: "Gross sales − promo − reward − the sales part of refunds.",
  tax: "Hawaii GET charged on those orders, less the tax part of refunds.",
  tips: "Tips charged, less the tip part of refunds. Never part of sales.",
  orders: "How many paid orders.",
  aov: "Average order value: sales after discounts, before refunds, tax and tips, per order.",
  products: "Units sold and their line totals (item price with add-ons, before order discounts), by the name on the order.",
  modifiers: "How many times each add-on was chosen (pumps and shots counted), and what it added to line prices.",
  peak: "Paid orders by Honolulu weekday and hour placed.",
  catering: "Catering requests paid in the range, by the Honolulu date they were paid, from the paid quote. Reported separately from orders.",
  discounts: "Promo codes and rewards used on paid orders in the range.",
} as const;

// ---------------------------------------------------------------------------
// Date ranges (Honolulu calendar dates, inclusive).
// ---------------------------------------------------------------------------

export const REPORT_PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom" },
] as const;

export type ReportPreset = (typeof REPORT_PRESETS)[number]["id"];

export interface ReportRange {
  preset: ReportPreset;
  from: string;
  to: string;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_REPORT_DAYS = 732;

/** "2026-03-31" + 1 -> "2026-04-01". Calendar arithmetic, no timezone. */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const isRealDate = (key: string) => DATE_KEY.test(key) && addDaysToKey(key, 0) === key;

/** The range a preset covers on the Honolulu date `now` falls on. */
export function presetRange(preset: Exclude<ReportPreset, "custom">, now: Date): ReportRange {
  const today = cafeDateKey(now);
  const monthStart = `${today.slice(0, 8)}01`;
  switch (preset) {
    case "today":
      return { preset, from: today, to: today };
    case "yesterday": {
      const yesterday = addDaysToKey(today, -1);
      return { preset, from: yesterday, to: yesterday };
    }
    case "last7":
      return { preset, from: addDaysToKey(today, -6), to: today };
    case "this_month":
      return { preset, from: monthStart, to: today };
    case "last_month": {
      const lastDay = addDaysToKey(monthStart, -1);
      return { preset, from: `${lastDay.slice(0, 8)}01`, to: lastDay };
    }
  }
}

/**
 * The range from the page's search params: a preset, or custom from/to.
 * Anything malformed, reversed or longer than two years falls back to the
 * last 7 days, with a message.
 */
export function parseReportRange(
  params: { preset?: string; from?: string; to?: string },
  now: Date,
): { range: ReportRange; problem: string | null } {
  const preset = REPORT_PRESETS.some((p) => p.id === params.preset) ? (params.preset as ReportPreset) : "last7";
  if (preset !== "custom") return { range: presetRange(preset, now), problem: null };
  const from = params.from ?? "";
  const to = params.to ?? "";
  if (!isRealDate(from) || !isRealDate(to)) {
    return { range: presetRange("last7", now), problem: "Pick both a start and an end date." };
  }
  if (to < from) return { range: presetRange("last7", now), problem: "The start date must be on or before the end date." };
  if (daysBetween(from, to) >= MAX_REPORT_DAYS) {
    return { range: presetRange("last7", now), problem: "Reports cover up to two years at a time." };
  }
  return { range: { preset, from, to }, problem: null };
}

// ---------------------------------------------------------------------------
// Refunds, split like the SQL (report_order_facts).
// ---------------------------------------------------------------------------

/** round(a * b / c), half up, for non-negative integers. */
function mulDivRound(a: number, b: number, c: number): number {
  return c === 0 ? 0 : Math.floor((2 * a * b + c) / (2 * c));
}

/** How much of a refund is sales, tax and tip: in the order's own proportions; sales takes the remainder. */
export function splitRefund(order: { totalCents: number; taxCents: number; tipCents: number }, refundedCents: number) {
  const refunded = Math.min(Math.max(refundedCents, 0), order.totalCents);
  const tax = mulDivRound(refunded, order.taxCents, order.totalCents);
  const tip = Math.min(mulDivRound(refunded, order.tipCents, order.totalCents), refunded - tax);
  return { refunded, tax, tip, sales: refunded - tax - tip };
}

// ---------------------------------------------------------------------------
// Totals.
// ---------------------------------------------------------------------------

export interface SalesDay {
  businessDate: string;
  orders: number;
  grossSalesCents: number;
  promoDiscountCents: number;
  rewardDiscountCents: number;
  refundedCents: number;
  refundedSalesCents: number;
  netSalesCents: number;
  taxCents: number;
  tipCents: number;
  netBeforeRefundsCents: number;
  collectedCents: number;
}

export type SalesTotals = Omit<SalesDay, "businessDate"> & { averageOrderValueCents: number };

export function averageOrderValue(netBeforeRefundsCents: number, orders: number): number {
  return orders === 0 ? 0 : Math.round(netBeforeRefundsCents / orders);
}

export function sumSales(days: readonly SalesDay[]): SalesTotals {
  const totals = days.reduce(
    (sum, d) => ({
      orders: sum.orders + d.orders,
      grossSalesCents: sum.grossSalesCents + d.grossSalesCents,
      promoDiscountCents: sum.promoDiscountCents + d.promoDiscountCents,
      rewardDiscountCents: sum.rewardDiscountCents + d.rewardDiscountCents,
      refundedCents: sum.refundedCents + d.refundedCents,
      refundedSalesCents: sum.refundedSalesCents + d.refundedSalesCents,
      netSalesCents: sum.netSalesCents + d.netSalesCents,
      taxCents: sum.taxCents + d.taxCents,
      tipCents: sum.tipCents + d.tipCents,
      netBeforeRefundsCents: sum.netBeforeRefundsCents + d.netBeforeRefundsCents,
      collectedCents: sum.collectedCents + d.collectedCents,
    }),
    {
      orders: 0, grossSalesCents: 0, promoDiscountCents: 0, rewardDiscountCents: 0, refundedCents: 0, refundedSalesCents: 0,
      netSalesCents: 0, taxCents: 0, tipCents: 0, netBeforeRefundsCents: 0, collectedCents: 0,
    },
  );
  return { ...totals, averageOrderValueCents: averageOrderValue(totals.netBeforeRefundsCents, totals.orders) };
}

/** Every date in the range, with zeros where nothing was sold (charts need the gaps). */
export function fillDays(range: Pick<ReportRange, "from" | "to">, days: readonly SalesDay[]): SalesDay[] {
  const byDate = new Map(days.map((d) => [d.businessDate, d]));
  const out: SalesDay[] = [];
  for (let key = range.from; key <= range.to; key = addDaysToKey(key, 1)) {
    out.push(
      byDate.get(key) ?? {
        businessDate: key, orders: 0, grossSalesCents: 0, promoDiscountCents: 0, rewardDiscountCents: 0, refundedCents: 0,
        refundedSalesCents: 0, netSalesCents: 0, taxCents: 0, tipCents: 0, netBeforeRefundsCents: 0, collectedCents: 0,
      },
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Peak hours.
// ---------------------------------------------------------------------------

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** 7 x 24 counts (weekday 0 = Sunday, hour 0-23, Honolulu), and the largest. */
export function peakGrid(cells: readonly { weekday: number; hour: number; orders: number }[]): { grid: number[][]; max: number } {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let max = 0;
  for (const cell of cells) {
    if (cell.weekday < 0 || cell.weekday > 6 || cell.hour < 0 || cell.hour > 23) continue;
    grid[cell.weekday][cell.hour] += cell.orders;
    max = Math.max(max, grid[cell.weekday][cell.hour]);
  }
  return { grid, max };
}

/** The hours worth showing: from the earliest to the latest hour with orders (at least 6 AM - 6 PM). */
export function activeHours(grid: readonly number[][]): number[] {
  let first = 6;
  let last = 18;
  grid.forEach((row) =>
    row.forEach((count, hour) => {
      if (count > 0) {
        first = Math.min(first, hour);
        last = Math.max(last, hour);
      }
    }),
  );
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

// ---------------------------------------------------------------------------
// CSV exports (rows for toCsv). Money as dollars; dates as Honolulu dates.
// ---------------------------------------------------------------------------

export const SALES_CSV_HEADER = [
  "Date", "Orders", "Gross sales", "Promo discounts", "Reward discounts", "Refunds", "Net sales", "Tax (GET)", "Tips",
  "Average order value", "Collected",
];

export function salesCsvRows(days: readonly SalesDay[]): CsvCell[][] {
  const totals = sumSales(days);
  const line = (label: string, d: Omit<SalesDay, "businessDate">, aov: number): CsvCell[] => [
    label, d.orders, csvDollars(d.grossSalesCents), csvDollars(d.promoDiscountCents), csvDollars(d.rewardDiscountCents),
    csvDollars(d.refundedCents), csvDollars(d.netSalesCents), csvDollars(d.taxCents), csvDollars(d.tipCents),
    csvDollars(aov), csvDollars(d.collectedCents),
  ];
  return [
    SALES_CSV_HEADER,
    ...days.map((d) => line(d.businessDate, d, averageOrderValue(d.netBeforeRefundsCents, d.orders))),
    line("Total", totals, totals.averageOrderValueCents),
  ];
}

export interface OrderExportRow {
  orderNumber: string;
  businessDate: string;
  placedAt: string;
  locationName: string;
  status: string;
  customerFirstName: string | null;
  itemCount: number;
  grossSalesCents: number;
  promoDiscountCents: number;
  rewardDiscountCents: number;
  netBeforeRefundsCents: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
  refundedCents: number;
  refundedSalesCents: number;
  refundedTaxCents: number;
  refundedTipCents: number;
  netSalesCents: number;
  netTaxCents: number;
  netTipCents: number;
  promoCode: string | null;
  rewards: string | null;
  pointsEarned: number;
  pointsRedeemed: number;
  paymentMethod: string | null;
}

export const ORDERS_CSV_HEADER = [
  "Order", "Date", "Placed at (Honolulu)", "Location", "Status", "Customer", "Items", "Gross sales", "Promo discount",
  "Reward discount", "Sales after discounts", "Tax (GET) charged", "Tip charged", "Total charged", "Refunded",
  "Refunded sales", "Refunded tax", "Refunded tip", "Net sales", "Net tax (GET)", "Net tips", "Promo code", "Rewards",
  "Points earned", "Points redeemed", "Payment method",
];

export function ordersCsvRows(rows: readonly OrderExportRow[], formatPlacedAt: (iso: string) => string): CsvCell[][] {
  return [
    ORDERS_CSV_HEADER,
    ...rows.map((r) => [
      r.orderNumber, r.businessDate, formatPlacedAt(r.placedAt), r.locationName, r.status, r.customerFirstName ?? "",
      r.itemCount, csvDollars(r.grossSalesCents), csvDollars(r.promoDiscountCents), csvDollars(r.rewardDiscountCents),
      csvDollars(r.netBeforeRefundsCents), csvDollars(r.taxCents), csvDollars(r.tipCents), csvDollars(r.totalCents),
      csvDollars(r.refundedCents), csvDollars(r.refundedSalesCents), csvDollars(r.refundedTaxCents), csvDollars(r.refundedTipCents),
      csvDollars(r.netSalesCents), csvDollars(r.netTaxCents), csvDollars(r.netTipCents), r.promoCode ?? "", r.rewards ?? "",
      r.pointsEarned, r.pointsRedeemed, r.paymentMethod ?? "",
    ]),
  ];
}

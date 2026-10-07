/**
 * How a catering quote reads, line by line: the same rows on the request
 * page, the admin screen and every email.
 */
import { formatCents, formatTaxRate } from "@/lib/money";
import { formatCafeDate, formatCafeTimeOfDay } from "@/lib/time";

export interface QuoteTotals {
  itemsSubtotalCents: number;
  discountCents: number;
  discountLabel: string | null;
  deliveryFeeCents: number;
  taxRate: number;
  taxCents: number;
  gratuityPercent: number | null;
  gratuityCents: number;
  totalCents: number;
}

export interface QuoteRow {
  label: string;
  /** "$5.75", "−$1.00" */
  amount: string;
  strong?: boolean;
}

export function quoteRows(q: QuoteTotals): QuoteRow[] {
  const rows: QuoteRow[] = [{ label: "Items", amount: formatCents(q.itemsSubtotalCents) }];
  if (q.discountCents > 0) rows.push({ label: q.discountLabel ?? "Discount", amount: `−${formatCents(q.discountCents)}` });
  if (q.deliveryFeeCents > 0) rows.push({ label: "Delivery fee", amount: formatCents(q.deliveryFeeCents) });
  rows.push({ label: `Tax (GET ${formatTaxRate(q.taxRate)})`, amount: formatCents(q.taxCents) });
  if (q.gratuityCents > 0) {
    rows.push({ label: q.gratuityPercent ? `Gratuity (${q.gratuityPercent}%)` : "Gratuity", amount: formatCents(q.gratuityCents) });
  }
  rows.push({ label: "Total", amount: formatCents(q.totalCents), strong: true });
  return rows;
}

/** "Sat, Oct 18 at 11:00 AM" (Honolulu). */
export function eventWhen(iso: string): string {
  const at = new Date(iso);
  return `${formatCafeDate(at)} at ${formatCafeTimeOfDay(at)}`;
}

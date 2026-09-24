/**
 * Subtotal, discounts, GET, tip and total -- the order calculateOrderTotal
 * works them out in. Shared by checkout and the confirmation page.
 */
import { formatCents } from "@/lib/money";

export interface BreakdownValues {
  subtotalCents: number;
  promoCode: string | null;
  promoDiscountCents: number;
  rewardDiscountCents: number;
  taxRate: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
}

/** 0.04712 -> "4.712%" */
function formatRate(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

export function OrderBreakdown({ values, totalLabel = "Total" }: { values: BreakdownValues; totalLabel?: string }) {
  const rows: { label: string; cents: number; negative?: boolean }[] = [{ label: "Subtotal", cents: values.subtotalCents }];
  if (values.promoDiscountCents > 0) {
    rows.push({ label: values.promoCode ? `Promo (${values.promoCode})` : "Promo", cents: values.promoDiscountCents, negative: true });
  }
  if (values.rewardDiscountCents > 0) rows.push({ label: "Reward", cents: values.rewardDiscountCents, negative: true });
  rows.push({ label: `GET (${formatRate(values.taxRate)})`, cents: values.taxCents });
  rows.push({ label: "Tip", cents: values.tipCents });

  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="tabular">
            {row.negative ? "−" : ""}
            {formatCents(row.cents)}
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t pt-2 text-base font-bold">
        <dt>{totalLabel}</dt>
        <dd className="tabular" data-testid="order-total">
          {formatCents(values.totalCents)}
        </dd>
      </div>
    </dl>
  );
}

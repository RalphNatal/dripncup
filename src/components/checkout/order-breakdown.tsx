/**
 * Subtotal, discounts, GET, tip and total -- the order calculateOrderTotal
 * works them out in. Shared by checkout, the confirmation page and the
 * tracker.
 */
import { Gift, Sparkles } from "lucide-react";

import { formatCents, formatTaxRate } from "@/lib/money";
import { formatPoints } from "@/lib/rewards/model";

export interface BreakdownValues {
  subtotalCents: number;
  promoCode: string | null;
  promoDiscountCents: number;
  rewardDiscountCents: number;
  /** One row per reward ("Free drink: Latte"); without them, one "Reward" row. */
  rewards?: readonly { label: string; discountCents: number }[];
  taxRate: number;
  taxCents: number;
  tipCents: number;
  totalCents: number;
}

export function OrderBreakdown({ values, totalLabel = "Total" }: { values: BreakdownValues; totalLabel?: string }) {
  const rows: { key: string; label: string; cents: number; negative?: boolean; reward?: boolean }[] = [
    { key: "subtotal", label: "Subtotal", cents: values.subtotalCents },
  ];
  if (values.promoDiscountCents > 0) {
    rows.push({
      key: "promo",
      label: values.promoCode ? `Promo (${values.promoCode})` : "Promo",
      cents: values.promoDiscountCents,
      negative: true,
    });
  }
  if (values.rewards?.length) {
    values.rewards.forEach((reward, index) =>
      rows.push({ key: `reward-${index}`, label: reward.label, cents: reward.discountCents, negative: true, reward: true }),
    );
  } else if (values.rewardDiscountCents > 0) {
    rows.push({ key: "reward", label: "Reward", cents: values.rewardDiscountCents, negative: true, reward: true });
  }
  rows.push({ key: "tax", label: `Tax (GET ${formatTaxRate(values.taxRate)})`, cents: values.taxCents });
  rows.push({ key: "tip", label: "Tip", cents: values.tipCents });

  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map((row) => (
        <div key={row.key} className="flex justify-between gap-3" data-testid={row.reward ? "reward-row" : undefined}>
          <dt className={row.reward ? "flex items-center gap-1.5 font-semibold text-brand-magenta-deep" : "text-muted-foreground"}>
            {row.reward ? <Gift className="size-4 shrink-0" aria-hidden="true" /> : null}
            {row.label}
          </dt>
          <dd className={row.reward ? "tabular font-semibold text-brand-magenta-deep" : "tabular"}>
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

/**
 * "You'll earn 12 points when you pick this up." -- or, once it has been
 * picked up, "You earned 12 points." Nothing for orders that earn none or
 * were cancelled.
 */
export function PointsNote({
  points,
  programName,
  state,
}: {
  points: number;
  programName: string;
  state: "upcoming" | "earned" | "none";
}) {
  if (points <= 0 || state === "none") return null;
  return (
    <p data-testid="points-note" className="mt-3 flex items-center gap-2 rounded-xl bg-brand-pink-soft px-3 py-2 text-sm font-medium">
      <Sparkles className="size-4 shrink-0 text-brand-magenta-deep" aria-hidden="true" />
      {state === "earned"
        ? `You earned ${formatPoints(points)} with ${programName}.`
        : `You'll earn ${formatPoints(points)} when you pick this up.`}
    </p>
  );
}

/** Small tag under a line that a reward paid for: "Free drink". */
export function RewardTag({ children }: { children: string }) {
  return (
    <p data-testid="line-reward" className="mt-0.5 inline-flex items-center gap-1 text-sm font-semibold text-brand-magenta-deep">
      <Gift className="size-3.5" aria-hidden="true" />
      {children}
    </p>
  );
}

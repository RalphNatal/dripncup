/**
 * Promo code rules. Evaluated only on the server -- the promos table is not
 * customer-readable -- but kept pure here so the rules have unit tests.
 *
 * Deliberately vague to the customer: a code that does not exist, is
 * switched off, has not started, has expired or is used up all come back as
 * the same `not_applicable`, so nobody can probe which codes are real. The
 * one specific answer is a minimum spend on an otherwise valid code, which
 * tells the customer how to use it.
 */
import { percentOf } from "./rounding";
import type { Cents } from "./types";

export interface PromoRule {
  id: string;
  code: string;
  type: "percent" | "fixed";
  /** For percent promos: 10 = 10%. Up to two decimals. */
  percent: number | null;
  /** For fixed promos. */
  amountCents: Cents | null;
  minSpendCents: Cents;
  /** Caps a percentage discount. */
  maxDiscountCents: Cents | null;
  /** Total paid redemptions allowed; null = unlimited. */
  usageLimit: number | null;
  /** Per customer; null = unlimited. */
  perUserLimit: number | null;
  timesUsed: number;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
}

export type PromoEvaluation =
  | { ok: true; discountCents: Cents }
  | { ok: false; reason: "not_applicable" }
  | { ok: false; reason: "min_spend"; minSpendCents: Cents };

const NOT_APPLICABLE = { ok: false, reason: "not_applicable" } as const;

/** The one message for every kind of unusable code. */
export const PROMO_NOT_APPLICABLE_MESSAGE = "This code can't be applied.";

/**
 * What a promo is worth on this subtotal.
 *
 * `customerUses` counts this customer's paid redemptions plus their other
 * unpaid checkouts using the code. Usage counts only grow when a payment
 * succeeds (the webhook records the redemption), never when a code is typed.
 */
export function evaluatePromo(
  promo: PromoRule | null,
  { subtotalCents, now, customerUses }: { subtotalCents: Cents; now: Date; customerUses: number },
): PromoEvaluation {
  if (!promo || !promo.isActive) return NOT_APPLICABLE;
  if (now < new Date(promo.startsAt)) return NOT_APPLICABLE;
  if (promo.endsAt && now >= new Date(promo.endsAt)) return NOT_APPLICABLE;
  if (promo.usageLimit !== null && promo.timesUsed >= promo.usageLimit) return NOT_APPLICABLE;
  if (promo.perUserLimit !== null && customerUses >= promo.perUserLimit) return NOT_APPLICABLE;

  const value =
    promo.type === "percent"
      ? promo.percent === null
        ? null
        : percentOf(subtotalCents, promo.percent)
      : promo.amountCents;
  if (value === null || value <= 0) return NOT_APPLICABLE;

  if (subtotalCents < promo.minSpendCents) {
    return { ok: false, reason: "min_spend", minSpendCents: promo.minSpendCents };
  }

  const capped = promo.maxDiscountCents === null ? value : Math.min(value, promo.maxDiscountCents);
  // Never more than the subtotal: a $5 code on a $3.75 cookie is worth $3.75.
  return { ok: true, discountCents: Math.max(0, Math.min(capped, subtotalCents)) };
}

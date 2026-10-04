/**
 * Overflow Rewards points: how many an order earns, and how many a refund
 * takes back. Integer arithmetic only, always rounding down.
 *
 *   eligible = the post-discount subtotal: promo and reward already taken
 *              off (so the part a reward paid for earns nothing), no GET,
 *              no tip. That is exactly `taxableCents` in the breakdown.
 *   earned   = floor(eligible dollars x points per dollar)
 *
 * Checkout works the number out (and the order stores it); the database
 * credits it when the order is picked up. Refund reversals happen in SQL
 * (`sync_order_loyalty`) because every refund path ends there;
 * `pointsToReverse` mirrors it for the UI and the tests, and a pgTAP test
 * checks the two agree.
 */
import type { Cents } from "./types";

export interface EarnPolicy {
  /** From `loyalty.points_per_dollar`; up to two decimals (1.5 = 3 points per $2). */
  pointsPerDollar: number;
  /** From `loyalty.catering_earns_points`. */
  cateringEarnsPoints: boolean;
}

export type EarningOrderKind = "order" | "catering";

/** What earns points: the post-discount subtotal, excluding tax and tip. */
export function pointsEligibleCents(breakdown: { taxableCents: Cents }): Cents {
  return Math.max(0, breakdown.taxableCents);
}

/** Points per dollar as whole hundredths: 1 -> 100, 1.5 -> 150. Zero for anything unusable. */
function rateHundredths(pointsPerDollar: number): number {
  if (!Number.isFinite(pointsPerDollar) || pointsPerDollar <= 0) return 0;
  return Math.round(pointsPerDollar * 100);
}

/** Points earned on `eligibleCents`, rounded down to a whole point. */
export function pointsForOrder(eligibleCents: Cents, policy: EarnPolicy, kind: EarningOrderKind = "order"): number {
  if (kind === "catering" && !policy.cateringEarnsPoints) return 0;
  if (!Number.isSafeInteger(eligibleCents) || eligibleCents <= 0) return 0;
  // cents x hundredths-of-a-point-per-dollar / (100 cents x 100) = points.
  return Math.floor((eligibleCents * rateHundredths(policy.pointsPerDollar)) / 10_000);
}

/**
 * How many more points to take back after a refund, given what has already
 * been reversed. Proportional to the share of the payment refunded, rounded
 * down (in the customer's favour); everything once the order is refunded in
 * full. Never negative, so a replay or an out-of-order event changes nothing.
 */
export function pointsToReverse({
  earned,
  paidCents,
  refundedCents,
  fullyRefunded,
  alreadyReversed,
}: {
  earned: number;
  paidCents: Cents;
  refundedCents: Cents;
  fullyRefunded: boolean;
  alreadyReversed: number;
}): number {
  if (earned <= 0) return 0;
  let target: number;
  if (fullyRefunded) target = earned;
  else if (paidCents > 0) target = Math.floor((earned * Math.min(refundedCents, paidCents)) / paidCents);
  else target = 0;
  return Math.max(0, target - alreadyReversed);
}

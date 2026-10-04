/**
 * What the cart and checkout Server Actions return. Plain data, safe to send
 * to the browser -- no ids of other customers, no provider secrets beyond the
 * one client secret for the customer's own payment.
 */
import type { PickupOptions } from "@/lib/checkout/pickup";
import type { DiscountPolicy, OrderBreakdown, RewardType } from "@/lib/pricing";

export type LineIssueCode =
  | "removed"
  | "unavailable_here"
  | "sold_out"
  | "invalid_selection"
  | "price_changed"
  | "wrong_location";

export interface LineIssue {
  code: LineIssueCode;
  message: string;
  /** Blocking issues must be fixed or the line removed before checkout. */
  blocking: boolean;
  oldPriceCents?: number;
  newPriceCents?: number;
}

export interface CheckedLine {
  id: string;
  issues: LineIssue[];
  /** Current catalogue view of the line; null when the product is gone. */
  current: {
    productName: string;
    productSlug: string;
    sizeName: string | null;
    summary: string[];
    unitPriceCents: number;
    lineTotalCents: number;
  } | null;
}

export interface CartLocation {
  id: string;
  name: string;
  /** Status label, e.g. "Open" or "Closed · Opens Fri 6:30 AM". */
  statusLabel: string;
  /** False when paused or a pop-up outside its window; closed can still schedule. */
  canCheckout: boolean;
  blockedReason: string | null;
}

export interface CartCheck {
  lines: CheckedLine[];
  location: CartLocation;
  subtotalCents: number;
  /** True when any line or the location blocks checkout. */
  blocked: boolean;
}

export type PromoStatus =
  | { code: string; state: "applied"; discountCents: number; message: null }
  | { code: string; state: "min_spend"; discountCents: 0; message: string }
  | { code: string; state: "invalid" | "rate_limited"; discountCents: 0; message: string };

/** A reward in the checkout's "Use a reward" list. */
export interface RewardOptionView {
  id: string;
  name: string;
  /** "Any drink, up to $7.50. Add-ons are extra." */
  details: string;
  type: RewardType;
  pointsCost: number;
  /** The customer has the points for it (counting what other chosen rewards use). */
  affordable: boolean;
  /** Something in the cart qualifies. */
  eligible: boolean;
  /** Why it can't be used right now, in a sentence; null when it can. */
  unavailableReason: string | null;
  /** What it would take off this order (the best line). */
  valueCents: number | null;
  /** Item rewards: the lines it could go on, best first. */
  lines: { lineId: string; label: string; valueCents: number }[];
}

export interface AppliedRewardView {
  rewardId: string;
  name: string;
  type: RewardType;
  pointsCost: number;
  /** Null for amount_off. */
  lineId: string | null;
  /** "Free drink: Latte" */
  label: string;
  discountCents: number;
}

export interface CheckoutRewards {
  programName: string;
  /** The ledger balance (held points already taken off). */
  balance: number;
  /** Points held by this customer's other unfinished checkouts. */
  heldPoints: number;
  policy: DiscountPolicy;
  options: RewardOptionView[];
  applied: AppliedRewardView[];
  /** Requested rewards that could not be used, and why; the page takes them off. */
  rejected: { rewardId: string; message: string }[];
  /** Points this order earns at pickup. */
  pointsToEarn: number;
}

export interface CheckoutQuote {
  cart: CartCheck;
  pickupOptions: PickupOptions;
  /** Null until a pickup time is chosen; otherwise whether it is still OK. */
  pickup: { ok: true; readyAt: string } | { ok: false; message: string } | null;
  promo: PromoStatus | null;
  breakdown: OrderBreakdown | null;
  rewards: CheckoutRewards | null;
  tipError: string | null;
  /** Human-readable reasons checkout cannot go ahead right now. */
  problems: string[];
}

export type CreateCheckoutResult =
  | { ok: true; orderId: string; orderNumber: string; clientSecret: string; totalCents: number }
  | { ok: true; orderId: string; alreadyPaid: true }
  | {
      ok: false;
      /** `expired`: this attempt's order was cancelled (expiry or a cancelled payment); start a new attempt. */
      code: "signed_out" | "rate_limited" | "invalid" | "changed" | "expired" | "payment_setup_failed" | "minimum_charge";
      message: string;
      quote?: CheckoutQuote;
    };

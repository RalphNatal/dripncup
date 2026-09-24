/**
 * Tips.
 *
 * Tipping is optional. A percentage tip is worked out on the post-discount,
 * pre-tax amount -- what the customer is actually paying for the food and
 * drink -- so it does not move if the GET rate changes. Tips are not taxed
 * (NEEDS_CONFIRMATION with the owner).
 *
 * A custom tip is capped at the lower of a fixed amount and a percentage of
 * the subtotal (by default $100 and 100%), to catch "$50" typed as "5000".
 */
import { divideRounded, percentOf } from "./rounding";
import type { Cents } from "./types";

export type TipChoice =
  | { kind: "none" }
  /** One of the configured presets, e.g. 18 (%). */
  | { kind: "percent"; percent: number }
  | { kind: "custom"; cents: Cents };

export interface TipPolicy {
  /** From settings `tip.presets`, e.g. [0, 15, 18, 20]. */
  presetPercents: readonly number[];
  customMaxCents: Cents;
  customMaxPercentOfSubtotal: number;
}

export type TipResult =
  | { ok: true; tipCents: Cents }
  | { ok: false; code: "unknown_preset" | "invalid_amount" }
  | { ok: false; code: "too_high"; maxCents: Cents };

/** The largest custom tip allowed on this subtotal. */
export function maxCustomTipCents(subtotalCents: Cents, policy: TipPolicy): Cents {
  return Math.min(policy.customMaxCents, divideRounded(subtotalCents * policy.customMaxPercentOfSubtotal, 100));
}

export function calculateTip(
  choice: TipChoice,
  { taxableCents, subtotalCents }: { taxableCents: Cents; subtotalCents: Cents },
  policy: TipPolicy,
): TipResult {
  switch (choice.kind) {
    case "none":
      return { ok: true, tipCents: 0 };

    case "percent":
      // Only the configured presets: a crafted request cannot pick 1000%.
      if (!policy.presetPercents.includes(choice.percent)) return { ok: false, code: "unknown_preset" };
      return { ok: true, tipCents: percentOf(taxableCents, choice.percent) };

    case "custom": {
      if (!Number.isInteger(choice.cents) || choice.cents < 0) return { ok: false, code: "invalid_amount" };
      const maxCents = maxCustomTipCents(subtotalCents, policy);
      if (choice.cents > maxCents) return { ok: false, code: "too_high", maxCents };
      return { ok: true, tipCents: choice.cents };
    }
  }
}

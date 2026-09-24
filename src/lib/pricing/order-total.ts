/**
 * `calculateOrderTotal`: the whole order, priced once, on the server.
 *
 *   1. Each line: validateSelection -> resolveSelection -> calculateLinePrice
 *      (the same functions the product sheet runs in the browser)
 *   2. subtotal  = sum of line totals
 *   3. discount  = promo, then reward (Phase 7), together never more than
 *                  the subtotal
 *   4. taxable   = subtotal - discount
 *      tax (GET) = taxable x rate, rounded once for the whole order
 *   5. tip       = on `taxable` (post-discount, pre-tax); not taxed
 *   6. total     = taxable + tax + tip
 *
 * Rounding (see ./rounding.ts): line prices are exact integer cents and need
 * none. Percentage promos, tax and percentage tips each round half away from
 * zero, exactly, in integer arithmetic -- once, at the order level, never per
 * line.
 */
import { calculateLinePrice } from "./price";
import { evaluatePromo, type PromoEvaluation, type PromoRule } from "./promo";
import { divideRounded, TAX_RATE_SCALE, taxRateUnits } from "./rounding";
import { resolveSelection } from "./selection";
import { calculateTip, type TipChoice, type TipPolicy, type TipResult } from "./tip";
import type {
  Cents,
  LineSelection,
  PricingModifierGroup,
  PricingProduct,
  PricingSize,
  SelectedModifier,
  SelectionError,
} from "./types";
import { validateSelection } from "./validate";

export interface OrderLineInput {
  product: PricingProduct;
  groups: readonly PricingModifierGroup[];
  selection: LineSelection;
  quantity: number;
}

export interface PricedLine {
  product: PricingProduct;
  size: PricingSize | null;
  /** The snapshot stored on order_items.modifiers. */
  modifiers: SelectedModifier[];
  basePriceCents: Cents;
  unitPriceCents: Cents;
  quantity: number;
  lineTotalCents: Cents;
  specialInstructions: string;
}

export interface OrderBreakdown {
  subtotalCents: Cents;
  promoDiscountCents: Cents;
  /** Phase 7 (rewards). Always 0 until then. */
  rewardDiscountCents: Cents;
  discountCents: Cents;
  taxableCents: Cents;
  /** The GET rate applied, e.g. 0.04712; stored on the order. */
  taxRate: number;
  taxCents: Cents;
  tipCents: Cents;
  totalCents: Cents;
}

export interface OrderTotalInput {
  lines: readonly OrderLineInput[];
  promo: PromoRule | null;
  /** This customer's uses of the promo (see evaluatePromo). */
  promoCustomerUses: number;
  /** Phase 7: the value of a redeemed reward, before capping. */
  rewardDiscountCents?: Cents;
  taxRate: number;
  tip: TipChoice;
  tipPolicy: TipPolicy;
  now: Date;
}

export type OrderTotalResult =
  | {
      ok: true;
      lines: PricedLine[];
      breakdown: OrderBreakdown;
      /** Null when no code was given. A failed code prices as no discount. */
      promo: PromoEvaluation | null;
    }
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "invalid_lines"; lineErrors: { index: number; errors: SelectionError[] }[] }
  | { ok: false; reason: "invalid_tip"; tip: Exclude<TipResult, { ok: true }> };

export function calculateOrderTotal(input: OrderTotalInput): OrderTotalResult {
  if (input.lines.length === 0) return { ok: false, reason: "empty" };

  // 1. Lines.
  const lineErrors: { index: number; errors: SelectionError[] }[] = [];
  const lines: PricedLine[] = [];

  input.lines.forEach((line, index) => {
    const errors = validateSelection(line.product, line.groups, line.selection);
    if (errors.length > 0) {
      lineErrors.push({ index, errors });
      return;
    }
    const size = line.product.sizes.find((s) => s.id === line.selection.sizeId) ?? null;
    const modifiers = resolveSelection(line.groups, line.selection.modifiers);
    const lineTotalCents = calculateLinePrice(line.product, size, modifiers, line.quantity);
    lines.push({
      product: line.product,
      size,
      modifiers,
      basePriceCents: size ? size.priceCents : line.product.basePriceCents,
      unitPriceCents: lineTotalCents / line.quantity,
      quantity: line.quantity,
      lineTotalCents,
      specialInstructions: (line.selection.specialInstructions ?? "").trim(),
    });
  });

  if (lineErrors.length > 0) return { ok: false, reason: "invalid_lines", lineErrors };

  // 2. Subtotal.
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

  // 3. Discounts: promo first, then reward, never beyond the subtotal.
  const promo = input.promo
    ? evaluatePromo(input.promo, { subtotalCents, now: input.now, customerUses: input.promoCustomerUses })
    : null;
  const promoDiscountCents = promo?.ok ? Math.min(promo.discountCents, subtotalCents) : 0;
  const rewardDiscountCents = Math.max(
    0,
    Math.min(input.rewardDiscountCents ?? 0, subtotalCents - promoDiscountCents),
  );
  const discountCents = promoDiscountCents + rewardDiscountCents;

  // 4. Tax on what is left, rounded once.
  const taxableCents = subtotalCents - discountCents;
  const taxCents = divideRounded(taxableCents * taxRateUnits(input.taxRate), TAX_RATE_SCALE);

  // 5. Tip, on the pre-tax, post-discount amount.
  const tip = calculateTip(input.tip, { taxableCents, subtotalCents }, input.tipPolicy);
  if (!tip.ok) return { ok: false, reason: "invalid_tip", tip };

  // 6. Total.
  const totalCents = taxableCents + taxCents + tip.tipCents;

  return {
    ok: true,
    lines,
    promo,
    breakdown: {
      subtotalCents,
      promoDiscountCents,
      rewardDiscountCents,
      discountCents,
      taxableCents,
      taxRate: input.taxRate,
      taxCents,
      tipCents: tip.tipCents,
      totalCents,
    },
  };
}

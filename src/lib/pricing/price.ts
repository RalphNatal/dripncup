/**
 * Line pricing. Integer cents throughout.
 *
 *   unit price = size price (or the product's base price)
 *              + sum of modifier deltas (x quantity when the group charges per unit)
 *   line price = unit price x line quantity
 *
 * `calculateOrderTotal` (Phase 4) sums these lines and then applies discount,
 * GET and tip; see ARCHITECTURE.md -> Pricing.
 */
import { MAX_LINE_QUANTITY } from "./constants";
import type { Cents, PricingProduct, PricingSize, SelectedModifier } from "./types";

/** What one chosen modifier adds to the unit price. */
export function modifierCents(modifier: SelectedModifier): Cents {
  return modifier.priceDeltaCents * (modifier.chargePerQuantity ? modifier.quantity : 1);
}

/**
 * Price of one unit. Never below zero: a negative modifier (bring your own
 * cup) can reduce a drink to free, but not into a refund.
 */
export function calculateUnitPrice(
  product: PricingProduct,
  size: PricingSize | null,
  modifiers: readonly SelectedModifier[],
): Cents {
  const base = size ? size.priceCents : product.basePriceCents;
  const extras = modifiers.reduce((sum, modifier) => sum + modifierCents(modifier), 0);
  return Math.max(0, base + extras);
}

/**
 * Price of the whole line.
 *
 * `selection` is the catalogue-priced output of `resolveSelection`, so no
 * price in it came from the browser. Throws on a quantity the order_items
 * table would reject, rather than pricing something that cannot be saved.
 */
export function calculateLinePrice(
  product: PricingProduct,
  size: PricingSize | null,
  selection: readonly SelectedModifier[],
  quantity: number,
): Cents {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw new RangeError(`Quantity must be a whole number from 1 to ${MAX_LINE_QUANTITY}`);
  }
  return calculateUnitPrice(product, size, selection) * quantity;
}

/** The "From $X.XX" on a menu card: the cheapest size, or the base price. */
export function startingPriceCents(product: Pick<PricingProduct, "basePriceCents" | "sizes">): Cents {
  if (product.sizes.length === 0) return product.basePriceCents;
  return Math.min(...product.sizes.map((s) => s.priceCents));
}

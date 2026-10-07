/**
 * `calculateCateringQuote`: a catering quote's totals, priced once, on the
 * server (the admin's quote builder shows the same function's answer as a
 * preview; what is stored always comes from the server's run).
 *
 *   1. lines      = quantity x unit price (menu lines prefilled at the menu
 *                   price, editable for catering pricing; custom lines)
 *   2. items      = sum of the lines
 *   3. discount   = a fixed amount or a percentage of the items, never more
 *                   than the items. The delivery fee is not discounted
 *   4. taxable    = items - discount, + the delivery fee if it is taxable,
 *                   + the gratuity if it is taxable (both settings)
 *      tax (GET)  = taxable x rate, rounded once for the whole quote
 *   5. gratuity   = optional: a percentage of items - discount (pre-tax, like
 *                   a tip at checkout) or a fixed amount
 *   6. total      = items - discount + delivery fee + tax + gratuity
 *
 * Same integer rounding as orders (./rounding.ts): half away from zero,
 * exactly, never per line.
 */
import { divideRounded, percentOf, TAX_RATE_SCALE, taxRateUnits } from "./rounding";
import type { Cents } from "./types";

export const CATERING_QUOTE_LIMITS = {
  maxLines: 60,
  maxQuantity: 10_000,
  /** $10,000.00 per unit: catches a typo, allows a large custom item. */
  maxUnitPriceCents: 1_000_000,
  maxDeliveryFeeCents: 100_000,
  maxGratuityPercent: 30,
} as const;

export interface CateringQuoteLineInput {
  kind: "product" | "custom";
  description: string;
  quantity: number;
  unitPriceCents: Cents;
}

export type CateringDiscountInput =
  | { kind: "amount"; amountCents: Cents; label?: string | null }
  | { kind: "percent"; percent: number; label?: string | null };

export type CateringGratuityInput = { kind: "percent"; percent: number } | { kind: "amount"; amountCents: Cents };

export interface CateringQuoteInput {
  lines: readonly CateringQuoteLineInput[];
  /** 0 for a pickup. */
  deliveryFeeCents: Cents;
  /** Setting catering.delivery_fee_taxable (NEEDS_CONFIRMATION). */
  deliveryFeeTaxable: boolean;
  discount: CateringDiscountInput | null;
  /** Off by default. */
  gratuity: CateringGratuityInput | null;
  /** Setting catering.gratuity_taxable (NEEDS_CONFIRMATION). */
  gratuityTaxable: boolean;
  /** The GET rate, e.g. 0.04712. */
  taxRate: number;
}

export interface CateringQuoteLine extends CateringQuoteLineInput {
  lineTotalCents: Cents;
}

export interface CateringQuoteBreakdown {
  itemsSubtotalCents: Cents;
  discountCents: Cents;
  discountLabel: string | null;
  deliveryFeeCents: Cents;
  deliveryFeeTaxable: boolean;
  taxableCents: Cents;
  taxRate: number;
  taxCents: Cents;
  /** Null when the gratuity is a fixed amount or there is none. */
  gratuityPercent: number | null;
  gratuityCents: Cents;
  gratuityTaxable: boolean;
  totalCents: Cents;
}

export type CateringQuoteProblem =
  | { field: "lines"; message: string }
  | { field: `lines.${number}`; message: string }
  | { field: "deliveryFee" | "discount" | "gratuity" | "taxRate"; message: string };

export type CateringQuoteResult =
  | { ok: true; lines: CateringQuoteLine[]; breakdown: CateringQuoteBreakdown }
  | { ok: false; problems: CateringQuoteProblem[] };

const isWholeCents = (value: number) => Number.isSafeInteger(value) && value >= 0;

function validate(input: CateringQuoteInput): CateringQuoteProblem[] {
  const problems: CateringQuoteProblem[] = [];
  const limits = CATERING_QUOTE_LIMITS;

  if (input.lines.length === 0) problems.push({ field: "lines", message: "Add at least one line." });
  if (input.lines.length > limits.maxLines) problems.push({ field: "lines", message: `At most ${limits.maxLines} lines.` });

  input.lines.forEach((line, index) => {
    const field = `lines.${index}` as const;
    if (!line.description.trim()) problems.push({ field, message: "Describe the line." });
    else if (line.description.trim().length > 200) problems.push({ field, message: "Keep the description under 200 characters." });
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > limits.maxQuantity) {
      problems.push({ field, message: `Quantity must be a whole number from 1 to ${limits.maxQuantity}.` });
    }
    if (!isWholeCents(line.unitPriceCents) || line.unitPriceCents > limits.maxUnitPriceCents) {
      problems.push({ field, message: "Enter a unit price between $0.00 and $10,000.00." });
    }
  });

  if (!isWholeCents(input.deliveryFeeCents) || input.deliveryFeeCents > limits.maxDeliveryFeeCents) {
    problems.push({ field: "deliveryFee", message: "Enter a delivery fee between $0.00 and $1,000.00." });
  }

  const discount = input.discount;
  if (discount?.kind === "amount" && !isWholeCents(discount.amountCents)) {
    problems.push({ field: "discount", message: "Enter a discount of $0.00 or more." });
  }
  if (discount?.kind === "percent" && !(Number.isFinite(discount.percent) && discount.percent >= 0 && discount.percent <= 100)) {
    problems.push({ field: "discount", message: "A percentage discount must be between 0 and 100." });
  }

  const gratuity = input.gratuity;
  if (gratuity?.kind === "percent" && !(Number.isFinite(gratuity.percent) && gratuity.percent >= 0 && gratuity.percent <= limits.maxGratuityPercent)) {
    problems.push({ field: "gratuity", message: `A gratuity must be between 0% and ${limits.maxGratuityPercent}%.` });
  }
  if (gratuity?.kind === "amount" && !isWholeCents(gratuity.amountCents)) {
    problems.push({ field: "gratuity", message: "Enter a gratuity of $0.00 or more." });
  }

  try {
    taxRateUnits(input.taxRate);
  } catch {
    problems.push({ field: "taxRate", message: "The tax rate setting is not valid." });
  }

  return problems;
}

export function calculateCateringQuote(input: CateringQuoteInput): CateringQuoteResult {
  const problems = validate(input);
  if (problems.length > 0) return { ok: false, problems };

  // 1-2. Lines and items.
  const lines: CateringQuoteLine[] = input.lines.map((line) => ({
    ...line,
    description: line.description.trim(),
    lineTotalCents: line.quantity * line.unitPriceCents,
  }));
  const itemsSubtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);

  // 3. Discount, on the items only.
  const discount = input.discount;
  const rawDiscount =
    discount === null ? 0 : discount.kind === "amount" ? discount.amountCents : percentOf(itemsSubtotalCents, discount.percent);
  const discountCents = Math.min(rawDiscount, itemsSubtotalCents);
  const itemsAfterDiscountCents = itemsSubtotalCents - discountCents;
  const discountLabel =
    discountCents > 0
      ? discount?.label?.trim() || (discount?.kind === "percent" ? `Discount (${discount.percent}%)` : "Discount")
      : null;

  // 5 (before tax, which may include it). Gratuity on the pre-tax, post-discount items.
  const gratuity = input.gratuity;
  const gratuityCents =
    gratuity === null ? 0 : gratuity.kind === "percent" ? percentOf(itemsAfterDiscountCents, gratuity.percent) : gratuity.amountCents;
  const gratuityPercent = gratuity?.kind === "percent" && gratuityCents > 0 ? gratuity.percent : null;

  // 4. Tax, once.
  const deliveryFeeCents = input.deliveryFeeCents;
  const taxableCents =
    itemsAfterDiscountCents + (input.deliveryFeeTaxable ? deliveryFeeCents : 0) + (input.gratuityTaxable ? gratuityCents : 0);
  const taxCents = divideRounded(taxableCents * taxRateUnits(input.taxRate), TAX_RATE_SCALE);

  // 6. Total.
  const totalCents = itemsAfterDiscountCents + deliveryFeeCents + taxCents + gratuityCents;

  return {
    ok: true,
    lines,
    breakdown: {
      itemsSubtotalCents,
      discountCents,
      discountLabel,
      deliveryFeeCents,
      deliveryFeeTaxable: input.deliveryFeeTaxable,
      taxableCents,
      taxRate: input.taxRate,
      taxCents,
      gratuityPercent,
      gratuityCents,
      gratuityTaxable: input.gratuityTaxable,
      totalCents,
    },
  };
}

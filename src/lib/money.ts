/**
 * Money handling.
 *
 * Every amount in this codebase is an integer number of US cents. Floats are
 * never used for money: 0.1 + 0.2 problems turn into one-cent discrepancies on
 * receipts, and GET is charged on a computed base where those compound.
 *
 * The only place cents become a decimal is at the formatting boundary here, and
 * at the Stripe API (which also takes integer cents).
 */
import { CURRENCY, LOCALE } from "@/lib/brand";

/** Branding-free alias that documents intent at call sites. */
export type Cents = number;

const currencyFormatter = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 575 -> "$5.75" */
export function formatCents(cents: Cents): string {
  return currencyFormatter.format(cents / 100);
}

/**
 * "$5.75" without the symbol, for places that render their own.
 * 575 -> "5.75"
 */
export function formatCentsPlain(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

/**
 * Signed display for modifier upcharges: 50 -> "+$0.50", 0 -> "", -25 -> "-$0.25".
 * Zero renders as an empty string so "Whole milk" does not read "Whole milk +$0.00".
 */
export function formatPriceDelta(cents: Cents): string {
  if (cents === 0) return "";
  const sign = cents > 0 ? "+" : "-";
  return `${sign}${formatCents(Math.abs(cents))}`;
}

/** "5.75" or 5.75 -> 575. Throws on anything that is not a clean amount. */
export function dollarsToCents(dollars: string | number): Cents {
  const value = typeof dollars === "string" ? Number(dollars.replace(/[$,\s]/g, "")) : dollars;
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot convert ${JSON.stringify(dollars)} to cents`);
  }
  return Math.round(value * 100);
}

/**
 * Rounds half away from zero, which is what a till does.
 *
 * Math.round() rounds half *up*, so -0.5 becomes -0 rather than -1. That
 * asymmetry would quietly favour one side on negative adjustments (refunds,
 * negative modifier deltas), so it is not used for money.
 */
export function roundCents(value: number): Cents {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Tax on a base amount at a fractional rate.
 *
 * Callers pass the *post-discount* subtotal, per the business rules: GET
 * applies after discounts and never to the tip.
 */
export function calculateTax(taxableBaseCents: Cents, rate: number): Cents {
  if (rate < 0) throw new Error("Tax rate cannot be negative");
  return roundCents(taxableBaseCents * rate);
}

/**
 * Tip from a preset percentage.
 *
 * Tipped on the pre-tax, post-discount subtotal, which is the convention
 * customers expect and keeps the tip stable if the tax rate changes.
 */
export function calculateTipFromPercent(subtotalCents: Cents, percent: number): Cents {
  if (percent < 0) throw new Error("Tip percent cannot be negative");
  return roundCents((subtotalCents * percent) / 100);
}

/** Clamps a value into a range; used by quantity steppers. */
/** A tax rate as a percentage: 0.04712 -> "4.712%". */
export function formatTaxRate(rate: number): string {
  return `${Number((rate * 100).toFixed(4))}%`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Rounding for money, done in integers.
 *
 * `taxable * 0.04712` in floating point can land a hair either side of a
 * half cent and round the wrong way. So rates and percentages are turned into
 * whole units first -- the GET rate into hundred-thousandths (the precision
 * of `orders.tax_rate numeric(7,5)`), percentages into hundredths of a
 * percent -- and every division rounds exactly, half away from zero, the way
 * a till does.
 */

/** Integer division rounded half away from zero. Exact for safe integers. */
export function divideRounded(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(`divideRounded needs safe integers and a positive divisor (${numerator}/${denominator})`);
  }
  const magnitude = Math.abs(numerator);
  const quotient = Math.floor(magnitude / denominator);
  const remainder = magnitude - quotient * denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;
  return numerator < 0 ? -rounded : rounded;
}

/** The GET rate is stored with five decimal places: 0.04712. */
export const TAX_RATE_SCALE = 100_000;

/** 0.04712 -> 4712. Rejects a negative rate or one of 100% or more. */
export function taxRateUnits(rate: number): number {
  const units = Math.round(rate * TAX_RATE_SCALE);
  if (!Number.isFinite(rate) || units < 0 || units >= TAX_RATE_SCALE) {
    throw new RangeError(`Tax rate must be at least 0 and below 1 (got ${rate})`);
  }
  return units;
}

/** 12.5 (%) -> 1250 hundredths of a percent; promo percentages have two decimals. */
export function percentHundredths(percent: number): number {
  const units = Math.round(percent * 100);
  if (!Number.isFinite(percent) || units < 0) throw new RangeError(`Percent must be 0 or more (got ${percent})`);
  return units;
}

/** `amount * percent%`, rounded half away from zero. */
export function percentOf(amountCents: number, percent: number): number {
  return divideRounded(amountCents * percentHundredths(percent), 100 * 100);
}

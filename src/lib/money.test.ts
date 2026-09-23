import { describe, expect, it } from "vitest";

import {
  calculateTax,
  calculateTipFromPercent,
  dollarsToCents,
  formatCents,
  formatCentsPlain,
  formatPriceDelta,
  roundCents,
} from "./money";

describe("formatCents", () => {
  it("formats whole and fractional amounts as USD", () => {
    expect(formatCents(575)).toBe("$5.75");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(100_000)).toBe("$1,000.00");
  });

  it("formats without the symbol when asked", () => {
    expect(formatCentsPlain(575)).toBe("5.75");
  });
});

describe("formatPriceDelta", () => {
  it("renders nothing for a free option, so labels do not read '+$0.00'", () => {
    expect(formatPriceDelta(0)).toBe("");
  });

  it("signs upcharges and discounts", () => {
    expect(formatPriceDelta(50)).toBe("+$0.50");
    expect(formatPriceDelta(-25)).toBe("-$0.25");
  });
});

describe("dollarsToCents", () => {
  it("accepts numbers, strings and decorated strings", () => {
    expect(dollarsToCents(5.75)).toBe(575);
    expect(dollarsToCents("5.75")).toBe(575);
    expect(dollarsToCents("$1,234.50")).toBe(123_450);
  });

  it("avoids float drift on values that do not divide cleanly", () => {
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(dollarsToCents(19.99)).toBe(1999);
  });

  it("rejects anything that is not a number", () => {
    expect(() => dollarsToCents("free")).toThrow();
  });
});

describe("roundCents", () => {
  it("rounds half away from zero in both directions", () => {
    // Math.round would give 1 and -0 here; a till gives 1 and -1.
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(2.5)).toBe(3);
    expect(roundCents(-2.5)).toBe(-3);
  });

  it("leaves whole cents alone", () => {
    expect(roundCents(575)).toBe(575);
  });
});

describe("calculateTax", () => {
  const GET = 0.04712; // Oahu visible pass-on rate

  it("applies GET to the post-discount base", () => {
    // $10.00 at 4.712% = 47.12c -> 47c
    expect(calculateTax(1000, GET)).toBe(47);
    // $5.75 at 4.712% = 27.094c -> 27c
    expect(calculateTax(575, GET)).toBe(27);
  });

  it("is zero on a zero base", () => {
    expect(calculateTax(0, GET)).toBe(0);
  });

  it("rejects a negative rate", () => {
    expect(() => calculateTax(1000, -0.01)).toThrow();
  });
});

describe("calculateTipFromPercent", () => {
  it("tips on the pre-tax, post-discount subtotal", () => {
    expect(calculateTipFromPercent(1000, 18)).toBe(180);
    expect(calculateTipFromPercent(575, 20)).toBe(115);
    expect(calculateTipFromPercent(1000, 0)).toBe(0);
  });

  it("rounds to the nearest cent", () => {
    // 15% of $5.75 = 86.25c
    expect(calculateTipFromPercent(575, 15)).toBe(86);
  });
});

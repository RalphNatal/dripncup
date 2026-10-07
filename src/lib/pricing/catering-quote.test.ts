import { describe, expect, it } from "vitest";

import { calculateCateringQuote, type CateringQuoteInput } from "./index";

const GET = 0.04712;

const base = (overrides: Partial<CateringQuoteInput> = {}): CateringQuoteInput => ({
  lines: [
    { kind: "product", description: "Latte (16 oz)", quantity: 20, unitPriceCents: 575 },
    { kind: "product", description: "POG Refresher (16 oz)", quantity: 10, unitPriceCents: 525 },
  ],
  deliveryFeeCents: 0,
  deliveryFeeTaxable: true,
  discount: null,
  gratuity: null,
  gratuityTaxable: false,
  taxRate: GET,
  ...overrides,
});

function totals(input: CateringQuoteInput) {
  const result = calculateCateringQuote(input);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.breakdown;
}

describe("calculateCateringQuote", () => {
  it("prices menu lines: quantity x unit, GET rounded once on the whole quote", () => {
    const quote = totals(base());
    // 20 x 5.75 + 10 x 5.25 = 115.00 + 52.50
    expect(quote.itemsSubtotalCents).toBe(16_750);
    expect(quote.taxableCents).toBe(16_750);
    // 16750 x 0.04712 = 789.26 -> 789
    expect(quote.taxCents).toBe(789);
    expect(quote.totalCents).toBe(17_539);
  });

  it("adds custom lines, such as a signature drink", () => {
    const result = calculateCateringQuote(
      base({ lines: [{ kind: "custom", description: "  Signature drink: Lilikoʻi Sunrise ", quantity: 75, unitPriceCents: 650 }] }),
    );
    expect(result.ok && result.lines[0]).toMatchObject({ description: "Signature drink: Lilikoʻi Sunrise", lineTotalCents: 48_750 });
    expect(result.ok && result.breakdown.totalCents).toBe(48_750 + 2297); // 48750 x 0.04712 = 2297.1
  });

  it("taxes the delivery fee when the setting says so", () => {
    const quote = totals(base({ deliveryFeeCents: 2500, deliveryFeeTaxable: true }));
    expect(quote.taxableCents).toBe(19_250);
    expect(quote.taxCents).toBe(907); // 19250 x 0.04712 = 907.06
    expect(quote.totalCents).toBe(16_750 + 2500 + 907);
  });

  it("leaves the delivery fee out of the taxable amount when it is not taxed", () => {
    const quote = totals(base({ deliveryFeeCents: 2500, deliveryFeeTaxable: false }));
    expect(quote.taxableCents).toBe(16_750);
    expect(quote.taxCents).toBe(789);
    expect(quote.totalCents).toBe(16_750 + 2500 + 789);
  });

  it("takes a fixed discount off the items before tax, never the delivery fee", () => {
    const quote = totals(base({ deliveryFeeCents: 2500, discount: { kind: "amount", amountCents: 1750, label: "Repeat client" } }));
    expect(quote.discountCents).toBe(1750);
    expect(quote.discountLabel).toBe("Repeat client");
    expect(quote.taxableCents).toBe(15_000 + 2500);
    expect(quote.totalCents).toBe(15_000 + 2500 + 825); // 17500 x 0.04712 = 824.6 -> 825
  });

  it("rounds a percentage discount half away from zero, and labels it", () => {
    // 10% of 16750 = 1675 exactly; 12.5% of 16750 = 2093.75 -> 2094
    expect(totals(base({ discount: { kind: "percent", percent: 10 } })).discountCents).toBe(1675);
    const quote = totals(base({ discount: { kind: "percent", percent: 12.5 } }));
    expect(quote.discountCents).toBe(2094);
    expect(quote.discountLabel).toBe("Discount (12.5%)");
  });

  it("never discounts more than the items", () => {
    const quote = totals(base({ deliveryFeeCents: 2500, discount: { kind: "amount", amountCents: 99_999 } }));
    expect(quote.discountCents).toBe(16_750);
    expect(quote.taxableCents).toBe(2500);
    expect(quote.totalCents).toBe(2500 + 118); // 2500 x 0.04712 = 117.8
  });

  it("adds an optional gratuity on the post-discount items, untaxed by default", () => {
    const quote = totals(base({ discount: { kind: "amount", amountCents: 750 }, gratuity: { kind: "percent", percent: 18 } }));
    // items after discount 16000; 18% = 2880
    expect(quote.gratuityCents).toBe(2880);
    expect(quote.gratuityPercent).toBe(18);
    expect(quote.taxableCents).toBe(16_000);
    expect(quote.totalCents).toBe(16_000 + 754 + 2880); // 16000 x 0.04712 = 753.92
  });

  it("taxes the gratuity when the setting says so", () => {
    const quote = totals(base({ gratuity: { kind: "amount", amountCents: 2000 }, gratuityTaxable: true }));
    expect(quote.gratuityPercent).toBeNull();
    expect(quote.taxableCents).toBe(18_750);
    expect(quote.taxCents).toBe(884); // 18750 x 0.04712 = 883.5 -> 884 (half away from zero)
  });

  it("rounds an exact half cent of tax up, once", () => {
    // 50 cents at 1% = 0.5 cents -> 1 cent
    const quote = totals(base({ lines: [{ kind: "custom", description: "Ice", quantity: 1, unitPriceCents: 50 }], taxRate: 0.01 }));
    expect(quote.taxCents).toBe(1);
  });

  it("with no gratuity and no discount, the total is items + fee + tax", () => {
    const quote = totals(base({ deliveryFeeCents: 1999 }));
    expect(quote.totalCents).toBe(quote.itemsSubtotalCents + quote.deliveryFeeCents + quote.taxCents);
    expect(quote.discountLabel).toBeNull();
    expect(quote.gratuityCents).toBe(0);
  });

  it("refuses what cannot be priced, naming the field", () => {
    const result = calculateCateringQuote(
      base({
        lines: [
          { kind: "custom", description: " ", quantity: 1, unitPriceCents: 100 },
          { kind: "product", description: "Latte", quantity: 0, unitPriceCents: 575 },
          { kind: "product", description: "Mocha", quantity: 2, unitPriceCents: 5.5 },
        ],
        deliveryFeeCents: -1,
        discount: { kind: "percent", percent: 120 },
        gratuity: { kind: "percent", percent: 45 },
        taxRate: 1.5,
      }),
    );
    expect(result.ok).toBe(false);
    const fields = !result.ok ? result.problems.map((p) => p.field) : [];
    expect(fields).toEqual(["lines.0", "lines.1", "lines.2", "deliveryFee", "discount", "gratuity", "taxRate"]);
  });

  it("needs at least one line", () => {
    const result = calculateCateringQuote(base({ lines: [] }));
    expect(result.ok).toBe(false);
  });
});

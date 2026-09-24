import { describe, expect, it } from "vitest";

import {
  calculateOrderTotal,
  calculateTip,
  divideRounded,
  evaluatePromo,
  maxCustomTipCents,
  taxRateUnits,
  type OrderLineInput,
  type OrderTotalInput,
  type PricingModifierGroup,
  type PricingProduct,
  type PromoRule,
  type TipPolicy,
} from "./index";

const NOW = new Date("2026-09-24T10:00:00-10:00");

const latte: PricingProduct = {
  id: "latte",
  name: "Latte",
  basePriceCents: 0,
  soldOut: false,
  sizes: [
    { id: "medium", name: "Medium", priceCents: 575, isDefault: true },
    { id: "large", name: "Large", priceCents: 650, isDefault: false },
  ],
};

const milk: PricingModifierGroup = {
  id: "milk",
  name: "Milk",
  selectionType: "single",
  required: true,
  minSelections: 1,
  maxSelections: 1,
  chargePerQuantity: true,
  quantityUnit: null,
  visibleWhenOptionId: null,
  options: [
    { id: "whole", name: "Whole milk", priceDeltaCents: 0, isDefault: true, maxQuantity: 1, soldOut: false },
    { id: "oat", name: "Oat milk", priceDeltaCents: 80, isDefault: false, maxQuantity: 1, soldOut: false },
  ],
};

const cookie: PricingProduct = { id: "cookie", name: "Cookie", basePriceCents: 375, soldOut: false, sizes: [] };

const lattes = (quantity: number, sizeId = "medium", milkId = "whole"): OrderLineInput => ({
  product: latte,
  groups: [milk],
  selection: { sizeId, modifiers: { milk: { [milkId]: 1 } } },
  quantity,
});

const cookies = (quantity: number): OrderLineInput => ({
  product: cookie,
  groups: [],
  selection: { sizeId: null, modifiers: {} },
  quantity,
});

const TIPS: TipPolicy = { presetPercents: [0, 15, 18, 20], customMaxCents: 10_000, customMaxPercentOfSubtotal: 100 };

const promo = (overrides: Partial<PromoRule> = {}): PromoRule => ({
  id: "promo",
  code: "MAHALO10",
  type: "percent",
  percent: 10,
  amountCents: null,
  minSpendCents: 0,
  maxDiscountCents: null,
  usageLimit: null,
  perUserLimit: null,
  timesUsed: 0,
  startsAt: "2026-01-01T00:00:00Z",
  endsAt: null,
  isActive: true,
  ...overrides,
});

function total(overrides: Partial<OrderTotalInput> = {}) {
  const result = calculateOrderTotal({
    lines: [lattes(2)],
    promo: null,
    promoCustomerUses: 0,
    taxRate: 0.04712,
    tip: { kind: "none" },
    tipPolicy: TIPS,
    now: NOW,
    ...overrides,
  });
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result;
}

describe("calculateOrderTotal", () => {
  it("prices lines with the shared engine and adds GET on top", () => {
    const { breakdown, lines } = total({ lines: [lattes(2, "large", "oat"), cookies(1)] });
    // 2 x (6.50 + 0.80) + 3.75 = 18.35
    expect(lines.map((l) => l.lineTotalCents)).toEqual([1460, 375]);
    expect(lines[0].unitPriceCents).toBe(730);
    expect(breakdown).toEqual({
      subtotalCents: 1835,
      promoDiscountCents: 0,
      rewardDiscountCents: 0,
      discountCents: 0,
      taxableCents: 1835,
      taxRate: 0.04712,
      taxCents: 86, // 86.4652
      tipCents: 0,
      totalCents: 1921,
    });
  });

  it("keeps the resolved snapshot and trimmed instructions on each line", () => {
    const line = lattes(1, "medium", "oat");
    line.selection.specialInstructions = "  extra hot  ";
    const { lines } = total({ lines: [line] });
    expect(lines[0].modifiers).toMatchObject([{ optionName: "Oat milk", priceDeltaCents: 80 }]);
    expect(lines[0].specialInstructions).toBe("extra hot");
    expect(lines[0].basePriceCents).toBe(575);
  });

  it("refuses lines the engine rejects, reporting which", () => {
    const result = calculateOrderTotal({
      lines: [lattes(1), { ...lattes(1), selection: { sizeId: "medium", modifiers: {} } }],
      promo: null,
      promoCustomerUses: 0,
      taxRate: 0.04712,
      tip: { kind: "none" },
      tipPolicy: TIPS,
      now: NOW,
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid_lines", lineErrors: [{ index: 1 }] });
  });

  it("refuses an empty order", () => {
    const empty = calculateOrderTotal({
      lines: [],
      promo: null,
      promoCustomerUses: 0,
      taxRate: 0.04712,
      tip: { kind: "none" },
      tipPolicy: TIPS,
      now: NOW,
    });
    expect(empty).toEqual({ ok: false, reason: "empty" });
  });

  describe("promos", () => {
    it("applies a percentage promo to the subtotal, then taxes what is left", () => {
      const { breakdown } = total({ lines: [lattes(2)], promo: promo({ percent: 10 }) });
      // 11.50 - 1.15 = 10.35; GET 0.4877 -> 0.49
      expect(breakdown).toMatchObject({
        subtotalCents: 1150,
        promoDiscountCents: 115,
        discountCents: 115,
        taxableCents: 1035,
        taxCents: 49,
        totalCents: 1084,
      });
    });

    it("applies a fixed promo", () => {
      const { breakdown } = total({ promo: promo({ type: "fixed", percent: null, amountCents: 500 }) });
      expect(breakdown).toMatchObject({ discountCents: 500, taxableCents: 650 });
    });

    it("caps a percentage promo at its maximum discount", () => {
      const { breakdown } = total({ lines: [lattes(20)], promo: promo({ percent: 50, maxDiscountCents: 500 }) });
      expect(breakdown.subtotalCents).toBe(11_500);
      expect(breakdown.discountCents).toBe(500);
    });

    it("never discounts more than the subtotal", () => {
      const { breakdown } = total({
        lines: [cookies(1)],
        promo: promo({ type: "fixed", percent: null, amountCents: 1000 }),
      });
      expect(breakdown).toMatchObject({ subtotalCents: 375, discountCents: 375, taxableCents: 0, taxCents: 0 });
    });

    it("keeps promo plus reward within the subtotal", () => {
      const { breakdown } = total({
        lines: [cookies(1)],
        promo: promo({ type: "fixed", percent: null, amountCents: 300 }),
        rewardDiscountCents: 650,
      });
      expect(breakdown).toMatchObject({ promoDiscountCents: 300, rewardDiscountCents: 75, discountCents: 375 });
    });

    it("prices an unusable code as no discount and says why", () => {
      const result = total({ promo: promo({ minSpendCents: 2500 }) });
      expect(result.breakdown.discountCents).toBe(0);
      expect(result.promo).toEqual({ ok: false, reason: "min_spend", minSpendCents: 2500 });
    });

    it("rounds a percentage discount half away from zero", () => {
      // 12.5% of $1.00 = 12.5 cents -> 13
      expect(evaluatePromo(promo({ percent: 12.5 }), { subtotalCents: 100, now: NOW, customerUses: 0 })).toEqual({
        ok: true,
        discountCents: 13,
      });
    });
  });

  describe("tax rounding", () => {
    it("rounds GET once, at the order level, half away from zero", () => {
      // $62.50 x 4.712% = 294.5 cents exactly -> 295
      const line: OrderLineInput = { ...cookies(1), product: { ...cookie, basePriceCents: 6250 } };
      expect(total({ lines: [line] }).breakdown.taxCents).toBe(295);
    });

    it("does not round per line", () => {
      // Twenty separate $1.01 lines. Rounded per line, GET would be
      // 4.759 -> 5 cents x 20 = $1.00. Rounded once on $20.20 it is
      // 95.18 -> 95 cents, which is what the customer owes.
      const line: OrderLineInput = { ...cookies(1), product: { ...cookie, basePriceCents: 101 } };
      expect(total({ lines: Array.from({ length: 20 }, () => line) }).breakdown.taxCents).toBe(95);
    });

    it("works in integers, so a float would not decide the cent", () => {
      expect(taxRateUnits(0.04712)).toBe(4712);
      expect(divideRounded(6250 * 4712, 100_000)).toBe(295);
      expect(divideRounded(-5, 10)).toBe(-1);
      expect(() => taxRateUnits(1)).toThrow(RangeError);
      expect(() => taxRateUnits(-0.01)).toThrow(RangeError);
    });

    it("charges no tax at a zero rate", () => {
      expect(total({ taxRate: 0 }).breakdown.taxCents).toBe(0);
    });
  });

  describe("tips", () => {
    it("adds a preset percentage of the post-discount, pre-tax amount, untaxed", () => {
      const { breakdown } = total({ promo: promo({ percent: 10 }), tip: { kind: "percent", percent: 18 } });
      // taxable 10.35; 18% = 1.863 -> 1.86. Tax is on 10.35 only.
      expect(breakdown).toMatchObject({ taxableCents: 1035, taxCents: 49, tipCents: 186, totalCents: 1270 });
    });

    it("adds a custom tip", () => {
      expect(total({ tip: { kind: "custom", cents: 250 } }).breakdown.tipCents).toBe(250);
    });

    it("treats no tip and a 0% preset the same", () => {
      expect(total({ tip: { kind: "none" } }).breakdown.tipCents).toBe(0);
      expect(total({ tip: { kind: "percent", percent: 0 } }).breakdown.tipCents).toBe(0);
    });

    it("refuses a percentage that is not a configured preset", () => {
      const result = calculateOrderTotal({
        lines: [lattes(1)],
        promo: null,
        promoCustomerUses: 0,
        taxRate: 0.04712,
        tip: { kind: "percent", percent: 1000 },
        tipPolicy: TIPS,
        now: NOW,
      });
      expect(result).toEqual({ ok: false, reason: "invalid_tip", tip: { ok: false, code: "unknown_preset" } });
    });

    it("caps a custom tip at the lesser of $100 and 100% of the subtotal", () => {
      expect(maxCustomTipCents(1150, TIPS)).toBe(1150);
      expect(maxCustomTipCents(50_000, TIPS)).toBe(10_000);
      expect(calculateTip({ kind: "custom", cents: 1150 }, { taxableCents: 1150, subtotalCents: 1150 }, TIPS)).toEqual({
        ok: true,
        tipCents: 1150,
      });
      expect(calculateTip({ kind: "custom", cents: 1151 }, { taxableCents: 1150, subtotalCents: 1150 }, TIPS)).toEqual({
        ok: false,
        code: "too_high",
        maxCents: 1150,
      });
      expect(
        calculateTip({ kind: "custom", cents: 10_001 }, { taxableCents: 50_000, subtotalCents: 50_000 }, TIPS),
      ).toMatchObject({ ok: false, code: "too_high", maxCents: 10_000 });
    });

    it("refuses a negative or fractional custom tip", () => {
      for (const cents of [-1, 1.5, Number.NaN]) {
        expect(calculateTip({ kind: "custom", cents }, { taxableCents: 1000, subtotalCents: 1000 }, TIPS)).toEqual({
          ok: false,
          code: "invalid_amount",
        });
      }
    });

    it("allows a zero custom tip", () => {
      expect(total({ tip: { kind: "custom", cents: 0 } }).breakdown.tipCents).toBe(0);
    });
  });
});

describe("evaluatePromo", () => {
  const ctx = { subtotalCents: 1500, now: NOW, customerUses: 0 };
  const notApplicable = { ok: false, reason: "not_applicable" };

  it("answers the same for missing, inactive, early, expired and used-up codes", () => {
    expect(evaluatePromo(null, ctx)).toEqual(notApplicable);
    expect(evaluatePromo(promo({ isActive: false }), ctx)).toEqual(notApplicable);
    expect(evaluatePromo(promo({ startsAt: "2026-10-01T00:00:00Z" }), ctx)).toEqual(notApplicable);
    expect(evaluatePromo(promo({ endsAt: "2026-09-01T00:00:00Z" }), ctx)).toEqual(notApplicable);
    expect(evaluatePromo(promo({ usageLimit: 5, timesUsed: 5 }), ctx)).toEqual(notApplicable);
    expect(evaluatePromo(promo({ perUserLimit: 1 }), { ...ctx, customerUses: 1 })).toEqual(notApplicable);
  });

  it("expires exactly at ends_at", () => {
    const endsAt = NOW.toISOString();
    expect(evaluatePromo(promo({ endsAt }), { ...ctx, now: new Date(NOW.getTime() - 1) }).ok).toBe(true);
    expect(evaluatePromo(promo({ endsAt }), ctx)).toEqual(notApplicable);
  });

  it("names the minimum spend only for an otherwise valid code", () => {
    expect(evaluatePromo(promo({ minSpendCents: 2000 }), ctx)).toEqual({
      ok: false,
      reason: "min_spend",
      minSpendCents: 2000,
    });
    // Expired and under the minimum: still just "can't be applied".
    expect(evaluatePromo(promo({ minSpendCents: 2000, endsAt: "2026-09-01T00:00:00Z" }), ctx)).toEqual(
      notApplicable,
    );
  });

  it("accepts exactly the minimum spend", () => {
    expect(evaluatePromo(promo({ minSpendCents: 1500 }), ctx).ok).toBe(true);
  });

  it("allows the last use under a limit", () => {
    expect(evaluatePromo(promo({ usageLimit: 5, timesUsed: 4 }), ctx).ok).toBe(true);
    expect(evaluatePromo(promo({ perUserLimit: 3 }), { ...ctx, customerUses: 2 }).ok).toBe(true);
  });
});

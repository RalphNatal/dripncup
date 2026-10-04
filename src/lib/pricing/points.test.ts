import { describe, expect, it } from "vitest";

import {
  calculateOrderTotal,
  pointsEligibleCents,
  pointsForOrder,
  pointsToReverse,
  type EarnPolicy,
  type PricingProduct,
  type PromoRule,
  type RewardRule,
} from "./index";

const ONE_PER_DOLLAR: EarnPolicy = { pointsPerDollar: 1, cateringEarnsPoints: false };

describe("pointsForOrder", () => {
  it("earns one point per whole dollar, rounding down", () => {
    expect(pointsForOrder(1199, ONE_PER_DOLLAR)).toBe(11);
    expect(pointsForOrder(1200, ONE_PER_DOLLAR)).toBe(12);
    expect(pointsForOrder(99, ONE_PER_DOLLAR)).toBe(0);
    expect(pointsForOrder(0, ONE_PER_DOLLAR)).toBe(0);
  });

  it("follows the configured rate, fractions included", () => {
    expect(pointsForOrder(1199, { ...ONE_PER_DOLLAR, pointsPerDollar: 2 })).toBe(23);
    expect(pointsForOrder(1000, { ...ONE_PER_DOLLAR, pointsPerDollar: 1.5 })).toBe(15);
    expect(pointsForOrder(333, { ...ONE_PER_DOLLAR, pointsPerDollar: 1.5 })).toBe(4); // 4.995
  });

  it("earns nothing on a broken rate rather than throwing", () => {
    expect(pointsForOrder(1000, { ...ONE_PER_DOLLAR, pointsPerDollar: Number.NaN })).toBe(0);
    expect(pointsForOrder(1000, { ...ONE_PER_DOLLAR, pointsPerDollar: -1 })).toBe(0);
  });

  it("leaves catering out unless it is switched on", () => {
    expect(pointsForOrder(10_000, ONE_PER_DOLLAR, "catering")).toBe(0);
    expect(pointsForOrder(10_000, { ...ONE_PER_DOLLAR, cateringEarnsPoints: true }, "catering")).toBe(100);
  });
});

describe("what earns points", () => {
  const latte: PricingProduct = {
    id: "latte",
    name: "Latte",
    basePriceCents: 0,
    soldOut: false,
    sizes: [{ id: "m", name: "Medium", priceCents: 650, isDefault: true }],
  };
  const cookie: PricingProduct = { id: "cookie", name: "Cookie", basePriceCents: 375, soldOut: false, sizes: [] };
  const freeDrink: RewardRule = {
    id: "fd", name: "Free drink", type: "free_item", pointsCost: 150, valueCents: 750, coversModifiers: false,
    productIds: [], categoryIds: ["drinks"], modifierGroupIds: [],
  };
  const promo: PromoRule = {
    id: "p", code: "ONE", type: "fixed", percent: null, amountCents: 100, minSpendCents: 0, maxDiscountCents: null,
    usageLimit: null, perUserLimit: null, timesUsed: 0, startsAt: "2026-01-01T00:00:00Z", endsAt: null, isActive: true,
  };

  function earnedOn(options: { promo?: PromoRule; reward?: RewardRule }) {
    const result = calculateOrderTotal({
      lines: [
        { lineId: "a", categoryId: "drinks", product: latte, groups: [], selection: { sizeId: "m", modifiers: {} }, quantity: 2 },
        { lineId: "b", categoryId: "food", product: cookie, groups: [], selection: { sizeId: null, modifiers: {} }, quantity: 1 },
      ],
      promo: options.promo ?? null,
      promoCustomerUses: 0,
      rewards: options.reward ? [{ reward: options.reward }] : [],
      taxRate: 0.04712,
      tip: { kind: "percent", percent: 20 },
      tipPolicy: { presetPercents: [0, 20], customMaxCents: 10_000, customMaxPercentOfSubtotal: 100 },
      now: new Date("2026-10-04T09:00:00-10:00"),
    });
    if (!result.ok) throw new Error(result.reason);
    return { breakdown: result.breakdown, points: pointsForOrder(pointsEligibleCents(result.breakdown), ONE_PER_DOLLAR) };
  }

  it("counts the subtotal, not the GET or the tip", () => {
    const { breakdown, points } = earnedOn({});
    // $16.75 of food and drink; the total with GET and a 20% tip is $20.89.
    expect(breakdown.totalCents).toBe(2089);
    expect(points).toBe(16);
  });

  it("counts what is left after a promo", () => {
    expect(earnedOn({ promo }).points).toBe(15); // 15.75
  });

  it("earns nothing on the part a reward paid for", () => {
    expect(earnedOn({ reward: freeDrink }).points).toBe(10); // 16.75 - 6.50 = 10.25
  });
});

describe("pointsToReverse", () => {
  const base = { earned: 12, paidCents: 1300, alreadyReversed: 0, fullyRefunded: false };

  it("takes back everything on a full refund", () => {
    expect(pointsToReverse({ ...base, refundedCents: 1300, fullyRefunded: true })).toBe(12);
  });

  it("takes back a proportional share of a partial refund, rounding down", () => {
    // 12 x 500 / 1300 = 4.6 -> 4
    expect(pointsToReverse({ ...base, refundedCents: 500 })).toBe(4);
    expect(pointsToReverse({ ...base, refundedCents: 100 })).toBe(0);
  });

  it("tops up after a second partial refund, against the running total", () => {
    // After 5.00 then another 5.00: 12 x 1000 / 1300 = 9.2 -> 9, of which 4 already gone.
    expect(pointsToReverse({ ...base, refundedCents: 1000, alreadyReversed: 4 })).toBe(5);
    // Refunding the rest finishes the job exactly.
    expect(pointsToReverse({ ...base, refundedCents: 1300, alreadyReversed: 9, fullyRefunded: true })).toBe(3);
  });

  it("does nothing on a replay", () => {
    expect(pointsToReverse({ ...base, refundedCents: 500, alreadyReversed: 4 })).toBe(0);
    expect(pointsToReverse({ ...base, refundedCents: 500, alreadyReversed: 12 })).toBe(0);
  });

  it("has nothing to reverse when nothing was earned or paid", () => {
    expect(pointsToReverse({ ...base, earned: 0, refundedCents: 1300, fullyRefunded: true })).toBe(0);
    expect(pointsToReverse({ ...base, paidCents: 0, refundedCents: 0 })).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  applyRewards,
  calculateOrderTotal,
  chooseDiscount,
  discountConflict,
  freeItemValue,
  lineMatchesReward,
  rewardCandidates,
  type OrderLineInput,
  type PricingModifierGroup,
  type PricingProduct,
  type PromoRule,
  type RewardLine,
  type RewardRule,
  type SelectedModifier,
} from "./index";

const reward = (overrides: Partial<RewardRule> = {}): RewardRule => ({
  id: "free-drink",
  name: "Free drink",
  type: "free_item",
  pointsCost: 150,
  valueCents: 750,
  coversModifiers: false,
  productIds: [],
  categoryIds: ["drinks"],
  modifierGroupIds: [],
  ...overrides,
});

const freeAddOn = (overrides: Partial<RewardRule> = {}) =>
  reward({ id: "free-addon", name: "Free add-on", type: "free_modifier", pointsCost: 50, valueCents: null, categoryIds: [], modifierGroupIds: ["syrups", "shots"], ...overrides });

const amountOff = (cents: number) =>
  reward({ id: "off", name: `${cents} off`, type: "amount_off", pointsCost: 250, valueCents: cents, categoryIds: [] });

const mod = (overrides: Partial<SelectedModifier>): SelectedModifier => ({
  groupId: "syrups",
  groupName: "Flavors",
  optionId: "vanilla",
  optionName: "Vanilla",
  quantity: 1,
  priceDeltaCents: 75,
  chargePerQuantity: false,
  quantityUnit: "pump",
  ...overrides,
});

/** A priced line; unit price = base + add-ons. */
function line(lineId: string, base: number, options: { categoryId?: string | null; modifiers?: SelectedModifier[]; quantity?: number; name?: string } = {}): RewardLine {
  const modifiers = options.modifiers ?? [];
  const extras = modifiers.reduce((sum, m) => sum + m.priceDeltaCents * (m.chargePerQuantity ? m.quantity : 1), 0);
  const unit = Math.max(0, base + extras);
  const quantity = options.quantity ?? 1;
  return {
    lineId,
    categoryId: options.categoryId === undefined ? "drinks" : options.categoryId,
    product: { id: `p-${lineId}`, name: options.name ?? lineId },
    modifiers,
    basePriceCents: base,
    unitPriceCents: unit,
    quantity,
    lineTotalCents: unit * quantity,
  };
}

describe("reward eligibility", () => {
  it("matches by category or product; empty lists match anything", () => {
    const drink = line("latte", 575);
    const pastry = line("malasada", 325, { categoryId: "food" });
    expect(lineMatchesReward(reward(), drink)).toBe(true);
    expect(lineMatchesReward(reward(), pastry)).toBe(false);
    expect(lineMatchesReward(reward({ categoryIds: [], productIds: ["p-malasada"] }), pastry)).toBe(true);
    expect(lineMatchesReward(reward({ categoryIds: [] }), pastry)).toBe(true);
    expect(lineMatchesReward(reward(), { ...drink, categoryId: null })).toBe(false);
  });

  it("has no candidates when nothing in the cart qualifies", () => {
    expect(rewardCandidates(reward(), [line("cookie", 375, { categoryId: "food" })])).toEqual([]);
    const [result] = applyRewards([line("cookie", 375, { categoryId: "food" })], [{ reward: reward() }], 10_000);
    expect(result).toMatchObject({ ok: false, reason: "no_eligible_line" });
  });
});

describe("value caps", () => {
  const vanilla = mod({});
  it("covers the size price up to the cap and charges add-ons by default", () => {
    expect(freeItemValue(reward(), line("latte", 575, { modifiers: [vanilla] }))).toBe(575);
    // Large signature latte: $8.25 size price, capped at $7.50.
    expect(freeItemValue(reward(), line("big", 825))).toBe(750);
  });

  it("counts add-ons towards the cap when the reward covers modifiers", () => {
    expect(freeItemValue(reward({ coversModifiers: true }), line("latte", 575, { modifiers: [vanilla] }))).toBe(650);
    expect(freeItemValue(reward({ coversModifiers: true }), line("latte", 700, { modifiers: [vanilla] }))).toBe(750);
  });

  it("has no cap when value_cents is null", () => {
    expect(freeItemValue(reward({ valueCents: null }), line("big", 1200))).toBe(1200);
  });

  it("never pays more than the unit costs after a discount add-on", () => {
    const byoCup = mod({ groupId: "cup", optionId: "byo", optionName: "Own cup", priceDeltaCents: -25 });
    expect(freeItemValue(reward(), line("latte", 575, { modifiers: [byoCup] }))).toBe(550);
  });

  it("caps a free add-on too", () => {
    const shots = mod({ groupId: "shots", optionId: "shot", optionName: "Extra shot", priceDeltaCents: 100, chargePerQuantity: true, quantity: 2 });
    const [result] = applyRewards([line("latte", 575, { modifiers: [shots] })], [{ reward: freeAddOn({ valueCents: 80 }) }], 10_000);
    expect(result).toMatchObject({ ok: true, discountCents: 80, optionName: "Extra shot" });
  });
});

describe("line selection", () => {
  it("picks the highest-priced eligible line by default", () => {
    const lines = [line("drip", 425), line("mocha", 625), line("cookie", 375, { categoryId: "food" })];
    expect(rewardCandidates(reward(), lines).map((c) => c.lineId)).toEqual(["mocha", "drip"]);
    expect(applyRewards(lines, [{ reward: reward() }], 10_000)[0]).toMatchObject({ ok: true, lineId: "mocha", discountCents: 625 });
  });

  it("breaks a tie at the cap by the higher unit price, then cart order", () => {
    const vanilla = mod({});
    const lines = [line("first", 800), line("second", 800, { modifiers: [vanilla] }), line("third", 800)];
    // All three are worth the $7.50 cap; the one with the add-on costs more.
    expect(rewardCandidates(reward(), lines).map((c) => c.lineId)).toEqual(["second", "first", "third"]);
  });

  it("uses the line the customer chose, if it is eligible", () => {
    const lines = [line("drip", 425), line("mocha", 625)];
    expect(applyRewards(lines, [{ reward: reward(), lineId: "drip" }], 10_000)[0]).toMatchObject({ ok: true, lineId: "drip", discountCents: 425 });
    expect(applyRewards(lines, [{ reward: reward(), lineId: "nope" }], 10_000)[0]).toMatchObject({ ok: false, reason: "line_not_eligible" });
  });

  it("frees one unit of a line with several", () => {
    const [result] = applyRewards([line("latte", 575, { quantity: 3 })], [{ reward: reward() }], 10_000);
    expect(result).toMatchObject({ ok: true, discountCents: 575 });
  });

  it("gives a free add-on to the most valuable eligible one", () => {
    const vanilla = mod({});
    const shot = mod({ groupId: "shots", optionId: "shot", optionName: "Extra shot", priceDeltaCents: 100, chargePerQuantity: true });
    const oat = mod({ groupId: "milk", optionId: "oat", optionName: "Oat milk", priceDeltaCents: 80 });
    const lines = [line("latte", 575, { modifiers: [oat, vanilla] }), line("mocha", 625, { modifiers: [shot] })];
    // Oat milk is not in the reward's groups.
    expect(rewardCandidates(freeAddOn(), lines).map((c) => [c.lineId, c.optionName, c.valueCents])).toEqual([
      ["mocha", "Extra shot", 100],
      ["latte", "Vanilla", 75],
    ]);
  });

  it("does not give the same unit away twice", () => {
    const lines = [line("latte", 575)];
    const results = applyRewards(lines, [{ reward: reward() }, { reward: reward() }], 10_000);
    expect(results.map((r) => r.ok)).toEqual([true, false]);
    // Two lattes on one line: one free each.
    const two = applyRewards([line("latte", 575, { quantity: 2 })], [{ reward: reward() }, { reward: reward() }], 10_000);
    expect(two.map((r) => (r.ok ? r.discountCents : 0))).toEqual([575, 575]);
  });

  it("frees one shot of several, then the next", () => {
    const shots = mod({ groupId: "shots", optionId: "shot", optionName: "Extra shot", priceDeltaCents: 100, chargePerQuantity: true, quantity: 2 });
    const results = applyRewards([line("latte", 575, { modifiers: [shots] })], [{ reward: freeAddOn() }, { reward: freeAddOn() }, { reward: freeAddOn() }], 10_000);
    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
  });
});

describe("amount off", () => {
  it("takes its value off, never more than what is left", () => {
    expect(applyRewards([line("latte", 575)], [{ reward: amountOff(1250) }], 575)[0]).toMatchObject({ ok: true, lineId: null, discountCents: 575 });
    expect(applyRewards([line("latte", 575)], [{ reward: amountOff(1250) }], 0)[0]).toMatchObject({ ok: false, reason: "nothing_to_discount" });
  });
});

describe("calculateOrderTotal with a reward", () => {
  const latte: PricingProduct = {
    id: "latte",
    name: "Latte",
    basePriceCents: 0,
    soldOut: false,
    sizes: [{ id: "medium", name: "Medium", priceCents: 625, isDefault: true }],
  };
  const syrups: PricingModifierGroup = {
    id: "syrups",
    name: "Flavors",
    selectionType: "multi",
    required: false,
    minSelections: 0,
    maxSelections: 3,
    chargePerQuantity: false,
    quantityUnit: "pump",
    visibleWhenOptionId: null,
    options: [{ id: "vanilla", name: "Vanilla", priceDeltaCents: 75, isDefault: false, maxQuantity: 6, soldOut: false }],
  };
  const cookie: PricingProduct = { id: "cookie", name: "Cookie", basePriceCents: 375, soldOut: false, sizes: [] };
  const lines: OrderLineInput[] = [
    { lineId: "a", categoryId: "drinks", product: latte, groups: [syrups], selection: { sizeId: "medium", modifiers: { syrups: { vanilla: 2 } } }, quantity: 1 },
    { lineId: "b", categoryId: "food", product: cookie, groups: [], selection: { sizeId: null, modifiers: {} }, quantity: 1 },
  ];
  const base = {
    lines,
    promo: null,
    promoCustomerUses: 0,
    taxRate: 0.04712,
    tip: { kind: "percent", percent: 20 } as const,
    tipPolicy: { presetPercents: [0, 15, 18, 20], customMaxCents: 10_000, customMaxPercentOfSubtotal: 100 },
    now: new Date("2026-10-04T09:00:00-10:00"),
  };

  it("discounts the free drink, then taxes and tips what is left", () => {
    const result = calculateOrderTotal({ ...base, rewards: [{ reward: reward() }] });
    if (!result.ok) throw new Error(result.reason);
    // 7.00 latte + 3.75 cookie; free drink covers the 6.25 size price, vanilla still charged.
    expect(result.rewards[0]).toMatchObject({ ok: true, lineId: "a", productName: "Latte", discountCents: 625 });
    expect(result.breakdown).toMatchObject({
      subtotalCents: 1075,
      rewardDiscountCents: 625,
      discountCents: 625,
      taxableCents: 450,
      taxCents: 21, // 450 x 4.712% = 21.204
      tipCents: 90, // 20% of 4.50
      totalCents: 561,
    });
  });

  it("prices an unusable reward as no discount", () => {
    const result = calculateOrderTotal({ ...base, lines: [lines[1]], rewards: [{ reward: reward() }] });
    if (!result.ok) throw new Error(result.reason);
    expect(result.rewards[0]).toMatchObject({ ok: false, reason: "no_eligible_line" });
    expect(result.breakdown.rewardDiscountCents).toBe(0);
  });

  it("keeps promo plus reward within the subtotal when stacking is allowed", () => {
    const promo: PromoRule = {
      id: "p", code: "TEN", type: "fixed", percent: null, amountCents: 1000, minSpendCents: 0, maxDiscountCents: null,
      usageLimit: null, perUserLimit: null, timesUsed: 0, startsAt: "2026-01-01T00:00:00Z", endsAt: null, isActive: true,
    };
    const result = calculateOrderTotal({ ...base, promo, rewards: [{ reward: reward() }] });
    if (!result.ok) throw new Error(result.reason);
    expect(result.breakdown).toMatchObject({ promoDiscountCents: 1000, rewardDiscountCents: 75, taxableCents: 0, taxCents: 0, tipCents: 0 });
  });
});

describe("one discount per order", () => {
  const strict = { allowPromoWithReward: false, maxRewardsPerOrder: 1 };
  const relaxed = { allowPromoWithReward: true, maxRewardsPerOrder: 2 };

  it("refuses a promo with a reward, and too many rewards", () => {
    expect(discountConflict({ hasPromo: true, rewardCount: 1 }, strict)).toEqual({ code: "promo_with_reward" });
    expect(discountConflict({ hasPromo: false, rewardCount: 2 }, strict)).toEqual({ code: "too_many_rewards", max: 1 });
    expect(discountConflict({ hasPromo: true, rewardCount: 0 }, strict)).toBeNull();
    expect(discountConflict({ hasPromo: false, rewardCount: 1 }, strict)).toBeNull();
    expect(discountConflict({ hasPromo: true, rewardCount: 2 }, relaxed)).toBeNull();
  });

  it("swaps a promo out for a reward, and says which", () => {
    expect(chooseDiscount({ promoCode: "MAHALO10", rewards: [] }, { kind: "reward", reward: "free-drink" }, strict)).toEqual({
      promoCode: null,
      rewards: ["free-drink"],
      removedPromo: "MAHALO10",
      removedRewards: [],
    });
  });

  it("swaps a reward out for a promo", () => {
    expect(chooseDiscount({ promoCode: null, rewards: ["free-drink"] }, { kind: "promo", code: "MAHALO10" }, strict)).toEqual({
      promoCode: "MAHALO10",
      rewards: [],
      removedPromo: null,
      removedRewards: ["free-drink"],
    });
  });

  it("replaces the oldest reward once the order is full", () => {
    expect(chooseDiscount({ promoCode: null, rewards: ["free-addon"] }, { kind: "reward", reward: "free-drink" }, strict)).toMatchObject({
      rewards: ["free-drink"],
      removedRewards: ["free-addon"],
    });
    expect(chooseDiscount({ promoCode: "TEN", rewards: ["free-addon"] }, { kind: "reward", reward: "free-drink" }, relaxed)).toMatchObject({
      promoCode: "TEN",
      rewards: ["free-addon", "free-drink"],
      removedPromo: null,
      removedRewards: [],
    });
  });
});

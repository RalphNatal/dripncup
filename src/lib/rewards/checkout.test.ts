import { describe, expect, it } from "vitest";

import type { RewardLine } from "@/lib/pricing";

import { PROMO_WITH_REWARD_MESSAGE, appliedRewards, resolveRewardChoices, rewardOptions } from "./checkout";
import type { RewardTier } from "./model";

const tier = (overrides: Partial<RewardTier>): RewardTier => ({
  id: "drink",
  name: "Free drink",
  description: null,
  type: "free_item",
  pointsCost: 150,
  valueCents: 750,
  coversModifiers: false,
  productIds: [],
  categoryIds: ["drinks"],
  modifierGroupIds: [],
  eligibilityLabel: "any drink",
  sortOrder: 10,
  ...overrides,
});

const drink = tier({});
const addOn = tier({ id: "addon", name: "Free add-on", type: "free_modifier", pointsCost: 50, valueCents: null, categoryIds: [], modifierGroupIds: ["syrups"], eligibilityLabel: "a flavor", sortOrder: 0 });
const tiers = [addOn, drink];
const strict = { allowPromoWithReward: false, maxRewardsPerOrder: 1 };

const latte: RewardLine = {
  lineId: "line-1",
  categoryId: "drinks",
  product: { id: "latte", name: "Latte" },
  modifiers: [],
  basePriceCents: 575,
  unitPriceCents: 575,
  quantity: 1,
  lineTotalCents: 575,
};
const cookie: RewardLine = { ...latte, lineId: "line-2", categoryId: "food", product: { id: "cookie", name: "Cookie" }, basePriceCents: 375, unitPriceCents: 375, lineTotalCents: 375 };

describe("resolveRewardChoices", () => {
  it("prices an affordable reward", () => {
    const result = resolveRewardChoices([{ rewardId: "drink" }], tiers, { spendable: 200, balance: 200, hasPromo: false, policy: strict });
    expect(result.requests.map((r) => r.reward.id)).toEqual(["drink"]);
    expect(result.rejected).toEqual([]);
  });

  it("refuses one the customer cannot afford, saying how many points are missing", () => {
    const result = resolveRewardChoices([{ rewardId: "drink" }], tiers, { spendable: 120, balance: 120, hasPromo: false, policy: strict });
    expect(result.requests).toEqual([]);
    expect(result.rejected).toEqual([{ rewardId: "drink", message: "You need 30 more points for Free drink." }]);
  });

  it("explains a negative balance instead", () => {
    const result = resolveRewardChoices([{ rewardId: "addon" }], tiers, { spendable: -20, balance: -20, hasPromo: false, policy: strict });
    expect(result.rejected[0].message).toMatch(/below zero/);
  });

  it("refuses unknown rewards and any beyond the per-order limit", () => {
    const result = resolveRewardChoices(
      [{ rewardId: "drink" }, { rewardId: "addon" }, { rewardId: "8c1f0a52-0000-4000-8000-000000000000" }],
      tiers,
      { spendable: 1000, balance: 1000, hasPromo: false, policy: strict },
    );
    expect(result.requests.map((r) => r.reward.id)).toEqual(["drink"]);
    expect(result.rejected.map((r) => r.message)).toEqual([
      "That reward isn't available any more.",
      "Only one reward can be used per order.",
    ]);
  });

  it("blocks a promo alongside a reward under the one-discount rule", () => {
    const result = resolveRewardChoices([{ rewardId: "drink" }], tiers, { spendable: 200, balance: 200, hasPromo: true, policy: strict });
    expect(result).toMatchObject({ requests: [], blocked: PROMO_WITH_REWARD_MESSAGE });
    const relaxed = resolveRewardChoices([{ rewardId: "drink" }], tiers, {
      spendable: 200,
      balance: 200,
      hasPromo: true,
      policy: { allowPromoWithReward: true, maxRewardsPerOrder: 1 },
    });
    expect(relaxed.blocked).toBeNull();
  });

  it("charges rewards against the balance in the order they were chosen", () => {
    const result = resolveRewardChoices([{ rewardId: "drink" }, { rewardId: "addon" }], tiers, {
      spendable: 180,
      balance: 180,
      hasPromo: false,
      policy: { allowPromoWithReward: false, maxRewardsPerOrder: 2 },
    });
    expect(result.requests.map((r) => r.reward.id)).toEqual(["drink"]);
    expect(result.rejected[0]).toMatchObject({ rewardId: "addon" });
  });
});

describe("appliedRewards", () => {
  it("labels what applied and explains what did not", () => {
    const { applied, rejected } = appliedRewards(
      [
        { ok: true, reward: drink, lineId: "line-1", productName: "Latte", optionId: null, optionName: null, discountCents: 575 },
        { ok: false, reward: addOn, reason: "no_eligible_line" },
      ],
      [drink, addOn],
    );
    expect(applied).toEqual([
      { rewardId: "drink", name: "Free drink", type: "free_item", pointsCost: 150, lineId: "line-1", label: "Free drink: Latte", discountCents: 575 },
    ]);
    expect(rejected).toEqual([{ rewardId: "addon", message: "Free add-on needs a flavor in your order." }]);
  });
});

describe("rewardOptions", () => {
  const base = {
    tiers,
    lines: [latte, cookie],
    lineLabels: new Map([["line-1", "Latte · Medium"], ["line-2", "Cookie"]]),
    applied: [],
    balance: 160,
    spendable: 160,
    heldPoints: 0,
    policy: strict,
    amountOffRoomCents: 950,
  };

  it("marks each reward usable or not, and why", () => {
    const [addOnOption, drinkOption] = rewardOptions(base);
    expect(drinkOption).toMatchObject({ affordable: true, eligible: true, unavailableReason: null, valueCents: 575 });
    expect(drinkOption.lines).toEqual([{ lineId: "line-1", label: "Latte · Medium", valueCents: 575 }]);
    expect(addOnOption).toMatchObject({ affordable: true, eligible: false, unavailableReason: "Add a flavor to use this reward." });
  });

  it("says how many points are missing, and mentions points held elsewhere", () => {
    const [, drinkOption] = rewardOptions({ ...base, balance: 10, spendable: 10, heldPoints: 150 });
    expect(drinkOption.affordable).toBe(false);
    expect(drinkOption.unavailableReason).toBe("You need 140 more points for Free drink. 150 points are held by an unfinished checkout.");
  });

  it("counts the points of the reward a new pick would replace", () => {
    const applied = [{ rewardId: "addon", name: "Free add-on", type: "free_modifier" as const, pointsCost: 50, lineId: "line-1", label: "x", discountCents: 75 }];
    // 160 points, 50 already on the add-on: the drink still fits because picking it replaces the add-on.
    const [, drinkOption] = rewardOptions({ ...base, applied });
    expect(drinkOption.affordable).toBe(true);
  });
});

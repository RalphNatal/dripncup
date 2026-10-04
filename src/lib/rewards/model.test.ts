import { describe, expect, it } from "vitest";

import { activityNote, decodeActivityCursor, encodeActivityCursor, toActivityEntry } from "./activity";
import {
  REWARDS_DEFAULTS,
  formatMemberCode,
  formatPoints,
  howItWorks,
  pointsNoteState,
  rewardLabel,
  rewardsSettingsFrom,
  sortTiers,
  tierDetails,
  tierProgress,
} from "./model";

const tiers = [
  { id: "drink", name: "Free drink", pointsCost: 150 },
  { id: "addon", name: "Free add-on", pointsCost: 50 },
  { id: "off", name: "$12.50 off", pointsCost: 250 },
];

describe("rewardsSettingsFrom", () => {
  it("reads the loyalty settings", () => {
    expect(
      rewardsSettingsFrom([
        { key: "loyalty.points_per_dollar", value: 1.5 },
        { key: "loyalty.catering_earns_points", value: true },
        { key: "loyalty.points_expire_after_months", value: 12 },
        { key: "loyalty.max_rewards_per_order", value: 2 },
        { key: "loyalty.allow_promo_with_reward", value: true },
        { key: "loyalty.program_name", value: "Cup Club" },
      ]),
    ).toEqual({
      programName: "Cup Club",
      earn: { pointsPerDollar: 1.5, cateringEarnsPoints: true },
      discount: { allowPromoWithReward: true, maxRewardsPerOrder: 2 },
      expireAfterMonths: 12,
    });
  });

  it("falls back to the documented defaults for missing or malformed rows", () => {
    expect(rewardsSettingsFrom([])).toEqual(REWARDS_DEFAULTS);
    expect(rewardsSettingsFrom([{ key: "loyalty.points_per_dollar", value: "lots" }]).earn.pointsPerDollar).toBe(1);
    expect(rewardsSettingsFrom([{ key: "loyalty.max_rewards_per_order", value: -3 }]).discount.maxRewardsPerOrder).toBe(0);
  });
});

describe("tierProgress", () => {
  it("measures progress towards the cheapest tier not yet affordable", () => {
    expect(tierProgress(30, tiers)).toEqual({
      next: { id: "addon", name: "Free add-on", pointsCost: 50 },
      pointsToNext: 20,
      percent: 60,
      affordableCount: 0,
    });
    expect(tierProgress(120, tiers)).toMatchObject({ next: { id: "drink" }, pointsToNext: 30, percent: 80, affordableCount: 1 });
  });

  it("is complete once every tier is affordable", () => {
    expect(tierProgress(300, tiers)).toEqual({ next: null, pointsToNext: 0, percent: 100, affordableCount: 3 });
  });

  it("starts at zero for a negative balance", () => {
    expect(tierProgress(-40, tiers)).toMatchObject({ next: { id: "addon" }, pointsToNext: 90, percent: 0 });
  });

  it("has nothing to aim at without tiers", () => {
    expect(tierProgress(10, [])).toEqual({ next: null, pointsToNext: 0, percent: 0, affordableCount: 0 });
  });
});

describe("sortTiers", () => {
  it("lists the cheapest first, then by the admin's order", () => {
    const sorted = sortTiers([
      { id: "b", pointsCost: 150, sortOrder: 20 },
      { id: "a", pointsCost: 150, sortOrder: 10 },
      { id: "c", pointsCost: 50, sortOrder: 99 },
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });
});

describe("how it works", () => {
  it("words the rules from the settings", () => {
    const text = howItWorks(REWARDS_DEFAULTS).map((s) => s.body).join(" ");
    expect(text).toContain("1 point for every $1");
    expect(text).toContain("Catering orders don't earn points.");
    expect(text).toContain("One reward per order");
    expect(text).toContain("can't be combined with a promo code");
    expect(text).toContain("never expire");
  });

  it("follows a change in the settings with no code change", () => {
    const text = howItWorks({
      programName: "Overflow Rewards",
      earn: { pointsPerDollar: 2, cateringEarnsPoints: true },
      discount: { allowPromoWithReward: true, maxRewardsPerOrder: 2 },
      expireAfterMonths: 12,
    })
      .map((s) => s.body)
      .join(" ");
    expect(text).toContain("2 points for every $1");
    expect(text).toContain("Catering orders earn points too.");
    expect(text).toContain("Up to 2 rewards per order");
    expect(text).toContain("you can use a promo code as well");
    expect(text).toContain("expire 12 months after you earn them");
  });
});

describe("labels", () => {
  it("names a reward the way receipts show it", () => {
    expect(rewardLabel({ name: "Free drink", type: "free_item", productName: "Latte", optionName: null })).toBe("Free drink: Latte");
    expect(rewardLabel({ name: "Free add-on", type: "free_modifier", productName: "Latte", optionName: "Vanilla" })).toBe(
      "Free add-on: Vanilla on Latte",
    );
    expect(rewardLabel({ name: "$12.50 off", type: "amount_off", productName: null, optionName: null })).toBe("$12.50 off");
  });

  it("describes what a tier covers", () => {
    expect(tierDetails({ type: "free_item", valueCents: 750, coversModifiers: false, eligibilityLabel: "any drink" })).toBe(
      "Any drink, up to $7.50. Add-ons are extra.",
    );
    expect(tierDetails({ type: "free_item", valueCents: null, coversModifiers: true, eligibilityLabel: null })).toBe("One item.");
    expect(tierDetails({ type: "amount_off", valueCents: 1250, coversModifiers: false, eligibilityLabel: null })).toBe("$12.50 off your order.");
  });

  it("formats points and member codes", () => {
    expect(formatPoints(1)).toBe("1 point");
    expect(formatPoints(1500)).toBe("1,500 points");
    expect(formatPoints(-20, { signed: true })).toBe("−20 points");
    expect(formatPoints(12, { signed: true })).toBe("+12 points");
    expect(formatMemberCode("ABCD1234EFGH")).toBe("ABCD 1234 EFGH");
  });

  it("says points are still to come, earned, or gone", () => {
    expect(pointsNoteState("placed")).toBe("upcoming");
    expect(pointsNoteState("picked_up")).toBe("earned");
    expect(pointsNoteState("refunded")).toBe("none");
    expect(pointsNoteState("cancelled")).toBe("none");
  });
});

describe("activity", () => {
  const row = {
    id: "0f4b3c3e-7c2f-4d8e-9a8e-1b2c3d4e5f60",
    created_at: "2026-10-04T20:00:00Z",
    kind: "reserved",
    points: -150,
    description: "Free drink",
    order_id: "1f4b3c3e-7c2f-4d8e-9a8e-1b2c3d4e5f60",
    order_number: "DC-261004-0001",
    reservation_status: "held",
  };

  it("tells a held reservation from one whose checkout was abandoned", () => {
    expect(activityNote(toActivityEntry(row))).toBe("Free drink · held until the order is paid");
    expect(activityNote(toActivityEntry({ ...row, reservation_status: "released" }))).toBe("Free drink · checkout not completed");
  });

  it("links an order only while it is still the customer's", () => {
    expect(toActivityEntry(row).orderId).toBe(row.order_id);
    expect(toActivityEntry({ ...row, order_number: null }).orderId).toBeNull();
  });

  it("round-trips the Show more cursor and rejects junk", () => {
    const entry = toActivityEntry(row);
    expect(decodeActivityCursor(encodeActivityCursor(entry))).toEqual({ createdAt: row.created_at, id: row.id });
    expect(decodeActivityCursor("nope|nope")).toBeNull();
    expect(decodeActivityCursor(null)).toBeNull();
  });
});

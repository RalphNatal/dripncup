/**
 * Overflow Rewards, shapes and pure helpers shared by the rewards page, Home,
 * checkout and receipts. Settings and tiers arrive from the database; the
 * fallbacks below only keep pages rendering if a settings row is missing.
 */
import { BRAND, SETTING_FALLBACKS } from "@/lib/brand";
import { formatCents } from "@/lib/money";
import type { DiscountPolicy, EarnPolicy, RewardRule, RewardType } from "@/lib/pricing";
import type { Tables } from "@/types/database";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface RewardsSettings {
  programName: string;
  earn: EarnPolicy;
  discount: DiscountPolicy;
  /** 0 = points never expire. */
  expireAfterMonths: number;
}

export const REWARDS_SETTING_KEYS = [
  "loyalty.program_name",
  "loyalty.points_per_dollar",
  "loyalty.catering_earns_points",
  "loyalty.points_expire_after_months",
  "loyalty.max_rewards_per_order",
  "loyalty.allow_promo_with_reward",
] as const;

/** Defaults match the seeded settings (all NEEDS_CONFIRMATION). */
export const REWARDS_DEFAULTS: RewardsSettings = {
  programName: BRAND.loyaltyProgramName,
  earn: { pointsPerDollar: SETTING_FALLBACKS.pointsPerDollar, cateringEarnsPoints: false },
  discount: { allowPromoWithReward: false, maxRewardsPerOrder: 1 },
  expireAfterMonths: 0,
};

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

export function rewardsSettingsFrom(rows: readonly { key: string; value: unknown }[]): RewardsSettings {
  const get = (key: (typeof REWARDS_SETTING_KEYS)[number]) => rows.find((row) => row.key === key)?.value;
  const name = get("loyalty.program_name");
  return {
    programName: typeof name === "string" && name.trim() ? name.trim() : REWARDS_DEFAULTS.programName,
    earn: {
      pointsPerDollar: Math.max(0, num(get("loyalty.points_per_dollar"), REWARDS_DEFAULTS.earn.pointsPerDollar)),
      cateringEarnsPoints: bool(get("loyalty.catering_earns_points"), REWARDS_DEFAULTS.earn.cateringEarnsPoints),
    },
    discount: {
      allowPromoWithReward: bool(get("loyalty.allow_promo_with_reward"), REWARDS_DEFAULTS.discount.allowPromoWithReward),
      maxRewardsPerOrder: Math.max(0, Math.floor(num(get("loyalty.max_rewards_per_order"), REWARDS_DEFAULTS.discount.maxRewardsPerOrder))),
    },
    expireAfterMonths: Math.max(0, Math.floor(num(get("loyalty.points_expire_after_months"), 0))),
  };
}

/**
 * "How it works", worded from the settings rather than hard-coded, so the
 * owner's answers on the earn rate, expiry and stacking show up as soon as
 * the settings change.
 */
export function howItWorks(settings: RewardsSettings): { title: string; body: string }[] {
  const rate = settings.earn.pointsPerDollar;
  const rateText = `${rate.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${rate === 1 ? "point" : "points"}`;
  const max = settings.discount.maxRewardsPerOrder;
  return [
    {
      title: "Earn",
      body:
        rate > 0
          ? `Get ${rateText} for every $1 you spend on food and drinks (after discounts, before tax and tip). Points land when you pick up your order.${settings.earn.cateringEarnsPoints ? " Catering orders earn points too." : " Catering orders don't earn points."}`
          : "Earning is paused for now.",
    },
    {
      title: "Redeem",
      body: `Choose a reward at checkout. ${max === 1 ? "One reward per order" : `Up to ${max} rewards per order`}, and ${settings.discount.allowPromoWithReward ? "you can use a promo code as well." : "a reward can't be combined with a promo code."} The part of an order a reward pays for doesn't earn points.`,
    },
    {
      title: "Held while you pay",
      body: "Picking a reward holds its points. They're spent once your payment goes through, and come straight back if you don't finish paying or the order is cancelled.",
    },
    {
      title: "Refunds",
      body: "If an order is refunded, the points it earned come off your balance (a share of them for a partial refund). That can take a balance below zero for a while; rewards unlock again once it's back above.",
    },
    {
      title: "Expiry",
      body:
        settings.expireAfterMonths > 0
          ? `Points expire ${settings.expireAfterMonths} ${settings.expireAfterMonths === 1 ? "month" : "months"} after you earn them, oldest first.`
          : "Your points never expire.",
    },
  ];
}

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

export interface RewardTier extends RewardRule {
  description: string | null;
  /** "any drink" -- what the customer needs in the cart. */
  eligibilityLabel: string | null;
  sortOrder: number;
}

export type RewardRow = Pick<
  Tables<"rewards">,
  | "id"
  | "name"
  | "description"
  | "type"
  | "points_cost"
  | "value_cents"
  | "covers_modifiers"
  | "applicable_product_ids"
  | "applicable_category_ids"
  | "applicable_modifier_group_ids"
  | "eligibility_label"
  | "sort_order"
>;

export const REWARD_COLUMNS =
  "id, name, description, type, points_cost, value_cents, covers_modifiers, applicable_product_ids, applicable_category_ids, applicable_modifier_group_ids, eligibility_label, sort_order";

export function toRewardTier(row: RewardRow): RewardTier {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    pointsCost: row.points_cost,
    valueCents: row.value_cents,
    coversModifiers: row.covers_modifiers,
    productIds: row.applicable_product_ids,
    categoryIds: row.applicable_category_ids,
    modifierGroupIds: row.applicable_modifier_group_ids,
    eligibilityLabel: row.eligibility_label,
    sortOrder: row.sort_order,
  };
}

/** Cheapest first, then the admin's order. */
export function sortTiers<T extends { pointsCost: number; sortOrder: number }>(tiers: readonly T[]): T[] {
  return [...tiers].sort((a, b) => a.pointsCost - b.pointsCost || a.sortOrder - b.sortOrder);
}

/** The fine print under a tier's name: "Any drink, up to $7.50. Add-ons are extra." */
export function tierDetails(tier: Pick<RewardTier, "type" | "valueCents" | "coversModifiers" | "eligibilityLabel">): string {
  const what = tier.eligibilityLabel ? tier.eligibilityLabel.replace(/^./, (c) => c.toUpperCase()) : null;
  switch (tier.type) {
    case "free_item": {
      const parts = [what ?? "One item", tier.valueCents !== null ? `up to ${formatCents(tier.valueCents)}` : null].filter(Boolean);
      return `${parts.join(", ")}.${tier.coversModifiers ? "" : " Add-ons are extra."}`;
    }
    case "free_modifier":
      return `${what ?? "One add-on"}${tier.valueCents !== null ? `, up to ${formatCents(tier.valueCents)}` : ""}, on the house.`;
    case "amount_off":
      return `${formatCents(tier.valueCents ?? 0)} off your order.`;
  }
}

export interface TierProgress {
  /** The cheapest tier the balance cannot reach yet; null when every tier is affordable. */
  next: Pick<RewardTier, "id" | "name" | "pointsCost"> | null;
  pointsToNext: number;
  /** 0-100, towards `next` (100 when there is no next tier). */
  percent: number;
  affordableCount: number;
}

/** Progress towards the next tier the customer cannot afford yet. */
export function tierProgress(balance: number, tiers: readonly Pick<RewardTier, "id" | "name" | "pointsCost">[]): TierProgress {
  const sorted = [...tiers].sort((a, b) => a.pointsCost - b.pointsCost);
  const affordableCount = sorted.filter((t) => balance >= t.pointsCost).length;
  const next = sorted.find((t) => balance < t.pointsCost) ?? null;
  if (!next) return { next: null, pointsToNext: 0, percent: sorted.length ? 100 : 0, affordableCount };
  const percent = Math.max(0, Math.min(100, Math.floor((Math.max(0, balance) / next.pointsCost) * 100)));
  return { next: { id: next.id, name: next.name, pointsCost: next.pointsCost }, pointsToNext: next.pointsCost - balance, percent, affordableCount };
}

// ---------------------------------------------------------------------------
// A reward as it appears on an order
// ---------------------------------------------------------------------------

export interface OrderRewardView {
  name: string;
  type: RewardType;
  pointsCost: number;
  discountCents: number;
  /** The line it was applied to, if any. */
  orderItemId: string | null;
  productName: string | null;
  optionName: string | null;
}

/** "Free drink: Latte", "Free add-on: Vanilla on Latte", "$12.50 off". */
export function rewardLabel(reward: Pick<OrderRewardView, "name" | "type" | "productName" | "optionName">): string {
  if (reward.type === "free_modifier" && reward.optionName) {
    return `${reward.name}: ${reward.optionName}${reward.productName ? ` on ${reward.productName}` : ""}`;
  }
  if (reward.type === "free_item" && reward.productName) return `${reward.name}: ${reward.productName}`;
  return reward.name;
}

/**
 * What a receipt says about the points an order earns: still to come while
 * it is on its way, earned once picked up, nothing once cancelled or
 * refunded (a refund reverses them).
 */
export function pointsNoteState(status: string): "upcoming" | "earned" | "none" {
  if (status === "picked_up") return "earned";
  if (["pending_payment", "placed", "accepted", "preparing", "ready"].includes(status)) return "upcoming";
  return "none";
}

/** "1 point", "150 points", "−20 points". */
export function formatPoints(points: number, { signed = false }: { signed?: boolean } = {}): string {
  const sign = signed ? (points > 0 ? "+" : points < 0 ? "−" : "") : points < 0 ? "−" : "";
  const value = Math.abs(points).toLocaleString("en-US");
  return `${sign}${value} ${Math.abs(points) === 1 ? "point" : "points"}`;
}

/** "ABCD EFGH JKMN": easier to read out than twelve characters in a row. */
export function formatMemberCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1 ");
}

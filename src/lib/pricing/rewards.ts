/**
 * Overflow Rewards at checkout: which rewards fit this cart, what each is
 * worth, which line it lands on, and whether a promo and a reward may be
 * combined. Pure, like the rest of the engine; `calculateOrderTotal` applies
 * the result in its reward-discount slot.
 *
 * Reward types (data, in the `rewards` table):
 *   free_item      one unit of an eligible line free, worth at most the cap.
 *                  By default the cap covers the size price and add-ons are
 *                  still charged (`coversModifiers: false`); with
 *                  `coversModifiers` the add-ons count towards the cap too
 *   free_modifier  one unit of one priced add-on from the eligible groups
 *   amount_off     a fixed amount off the order
 *
 * Line choice: by default the line where the reward is worth the most --
 * the highest-priced eligible line -- with ties going to the line with the
 * higher unit price, then the one first in the cart. The customer can name a
 * different eligible line instead.
 */
import type { Cents, SelectedModifier } from "./types";

export type RewardType = "free_item" | "free_modifier" | "amount_off";

export interface RewardRule {
  id: string;
  name: string;
  type: RewardType;
  pointsCost: number;
  /** amount_off: the amount. free_*: the cap (null = no cap). */
  valueCents: Cents | null;
  /** free_item: whether add-ons count towards the cap (false = charged on top). */
  coversModifiers: boolean;
  /** Lines a reward may use: by product or category. Both empty = any. */
  productIds: readonly string[];
  categoryIds: readonly string[];
  /** free_modifier: which add-on groups. Empty = any priced add-on. */
  modifierGroupIds: readonly string[];
}

/** What a reward needs to know about a priced cart line. `PricedLine` satisfies it. */
export interface RewardLine {
  lineId: string;
  categoryId: string | null;
  product: { id: string; name: string };
  modifiers: readonly SelectedModifier[];
  /** The size (or base) price of one unit, before add-ons. */
  basePriceCents: Cents;
  unitPriceCents: Cents;
  quantity: number;
  lineTotalCents: Cents;
}

export interface RewardRequest {
  reward: RewardRule;
  /** Apply to this cart line instead of the best one (item rewards only). */
  lineId?: string | null;
}

/** One place a reward could go, and what it would be worth there. */
export interface RewardCandidate {
  lineId: string;
  productName: string;
  /** free_modifier: the add-on made free. */
  optionId: string | null;
  optionName: string | null;
  valueCents: Cents;
  unitPriceCents: Cents;
}

export type RewardFailure = "no_eligible_line" | "line_not_eligible" | "nothing_to_discount";

export type RewardEvaluation =
  | {
      ok: true;
      reward: RewardRule;
      /** Null for amount_off. */
      lineId: string | null;
      productName: string | null;
      optionId: string | null;
      optionName: string | null;
      discountCents: Cents;
    }
  | { ok: false; reward: RewardRule; reason: RewardFailure };

function capped(value: Cents, cap: Cents | null): Cents {
  return Math.max(0, cap === null ? value : Math.min(value, cap));
}

/** Does the reward's product/category list include this line? */
export function lineMatchesReward(reward: RewardRule, line: Pick<RewardLine, "product" | "categoryId">): boolean {
  if (reward.productIds.length === 0 && reward.categoryIds.length === 0) return true;
  return (
    reward.productIds.includes(line.product.id) ||
    (line.categoryId !== null && reward.categoryIds.includes(line.categoryId))
  );
}

/** What one free unit of this line is worth under the reward's cap. */
export function freeItemValue(reward: RewardRule, line: Pick<RewardLine, "basePriceCents" | "unitPriceCents">): Cents {
  // A negative add-on (bring your own cup) can make the unit cheaper than
  // its size price; the reward never pays out more than the unit costs.
  const covered = reward.coversModifiers ? line.unitPriceCents : Math.min(line.basePriceCents, line.unitPriceCents);
  return capped(covered, reward.valueCents);
}

/** What one unit of an add-on costs: one shot, or a flavour's single charge. */
export function modifierUnitCents(modifier: SelectedModifier): Cents {
  return modifier.priceDeltaCents;
}

/** How many free units of this add-on the line holds (shots x drinks). */
function modifierUnits(modifier: SelectedModifier, line: RewardLine): number {
  return line.quantity * (modifier.chargePerQuantity ? modifier.quantity : 1);
}

interface Usage {
  /** Units of each line already made free by a free_item. */
  freeUnits: Map<string, number>;
  /** Add-on units already made free: `${lineId}:${optionId}`. */
  freeModifierUnits: Map<string, number>;
  /** Reward discount already on each line. */
  lineDiscount: Map<string, Cents>;
}

const emptyUsage = (): Usage => ({ freeUnits: new Map(), freeModifierUnits: new Map(), lineDiscount: new Map() });

function byBestValue(a: RewardCandidate, b: RewardCandidate, order: Map<string, number>): number {
  return b.valueCents - a.valueCents || b.unitPriceCents - a.unitPriceCents || order.get(a.lineId)! - order.get(b.lineId)!;
}

function candidatesWithUsage(reward: RewardRule, lines: readonly RewardLine[], usage: Usage): RewardCandidate[] {
  if (reward.type === "amount_off") return [];
  const order = new Map(lines.map((line, index) => [line.lineId, index]));
  const found: RewardCandidate[] = [];

  for (const line of lines) {
    if (!lineMatchesReward(reward, line)) continue;
    const room = line.lineTotalCents - (usage.lineDiscount.get(line.lineId) ?? 0);
    if (room <= 0) continue;

    if (reward.type === "free_item") {
      if ((usage.freeUnits.get(line.lineId) ?? 0) >= line.quantity) continue;
      const value = Math.min(freeItemValue(reward, line), room);
      if (value > 0) {
        found.push({
          lineId: line.lineId,
          productName: line.product.name,
          optionId: null,
          optionName: null,
          valueCents: value,
          unitPriceCents: line.unitPriceCents,
        });
      }
      continue;
    }

    // free_modifier: the line's most valuable eligible add-on.
    let best: RewardCandidate | null = null;
    for (const modifier of line.modifiers) {
      if (reward.modifierGroupIds.length > 0 && !reward.modifierGroupIds.includes(modifier.groupId)) continue;
      const key = `${line.lineId}:${modifier.optionId}`;
      if ((usage.freeModifierUnits.get(key) ?? 0) >= modifierUnits(modifier, line)) continue;
      const value = Math.min(capped(modifierUnitCents(modifier), reward.valueCents), line.unitPriceCents, room);
      if (value > 0 && (!best || value > best.valueCents)) {
        best = {
          lineId: line.lineId,
          productName: line.product.name,
          optionId: modifier.optionId,
          optionName: modifier.optionName,
          valueCents: value,
          unitPriceCents: line.unitPriceCents,
        };
      }
    }
    if (best) found.push(best);
  }

  return found.sort((a, b) => byBestValue(a, b, order));
}

/** Every line an item reward could go on, best first. Empty for amount_off. */
export function rewardCandidates(reward: RewardRule, lines: readonly RewardLine[]): RewardCandidate[] {
  return candidatesWithUsage(reward, lines, emptyUsage());
}

/**
 * Applies the requested rewards in order. Each item reward takes a unit (or
 * an add-on unit) the earlier ones have not; no line is discounted below
 * zero; and together they never exceed `maxTotalCents` (the subtotal less
 * any promo). A reward that cannot be used -- nothing eligible, the chosen
 * line is not eligible, or nothing left to take off -- fails on its own and
 * is not applied, so its points are not spent.
 */
export function applyRewards(
  lines: readonly RewardLine[],
  requests: readonly RewardRequest[],
  maxTotalCents: Cents,
): RewardEvaluation[] {
  const usage = emptyUsage();
  let remaining = Math.max(0, maxTotalCents);

  return requests.map(({ reward, lineId }): RewardEvaluation => {
    if (reward.type === "amount_off") {
      const discountCents = Math.min(reward.valueCents ?? 0, remaining);
      if (discountCents <= 0) return { ok: false, reward, reason: "nothing_to_discount" };
      remaining -= discountCents;
      return { ok: true, reward, lineId: null, productName: null, optionId: null, optionName: null, discountCents };
    }

    const candidates = candidatesWithUsage(reward, lines, usage);
    if (candidates.length === 0) return { ok: false, reward, reason: "no_eligible_line" };
    const chosen = lineId ? candidates.find((c) => c.lineId === lineId) : candidates[0];
    if (!chosen) return { ok: false, reward, reason: "line_not_eligible" };

    const discountCents = Math.min(chosen.valueCents, remaining);
    if (discountCents <= 0) return { ok: false, reward, reason: "nothing_to_discount" };
    remaining -= discountCents;

    usage.lineDiscount.set(chosen.lineId, (usage.lineDiscount.get(chosen.lineId) ?? 0) + discountCents);
    if (reward.type === "free_item") {
      usage.freeUnits.set(chosen.lineId, (usage.freeUnits.get(chosen.lineId) ?? 0) + 1);
    } else {
      const key = `${chosen.lineId}:${chosen.optionId}`;
      usage.freeModifierUnits.set(key, (usage.freeModifierUnits.get(key) ?? 0) + 1);
    }

    return {
      ok: true,
      reward,
      lineId: chosen.lineId,
      productName: chosen.productName,
      optionId: chosen.optionId,
      optionName: chosen.optionName,
      discountCents,
    };
  });
}

// ---------------------------------------------------------------------------
// Combining discounts.
// ---------------------------------------------------------------------------

export interface DiscountPolicy {
  /** `loyalty.allow_promo_with_reward`: false = a promo or a reward, not both. */
  allowPromoWithReward: boolean;
  /** `loyalty.max_rewards_per_order`. */
  maxRewardsPerOrder: number;
}

export type DiscountConflict =
  | { code: "promo_with_reward" }
  | { code: "too_many_rewards"; max: number };

/** Why this combination of promo and rewards is not allowed, or null when it is. */
export function discountConflict(
  { hasPromo, rewardCount }: { hasPromo: boolean; rewardCount: number },
  policy: DiscountPolicy,
): DiscountConflict | null {
  if (rewardCount > Math.max(0, policy.maxRewardsPerOrder)) {
    return { code: "too_many_rewards", max: Math.max(0, policy.maxRewardsPerOrder) };
  }
  if (hasPromo && rewardCount > 0 && !policy.allowPromoWithReward) return { code: "promo_with_reward" };
  return null;
}

export interface DiscountChoice<R> {
  promoCode: string | null;
  rewards: readonly R[];
}

/**
 * The customer picked a reward or a promo; what is on the order now, and
 * what had to come off to make room (so the page can say so). Picking a
 * reward when the order is full of them replaces the oldest; picking either
 * kind under the one-discount rule removes the other kind.
 */
export function chooseDiscount<R>(
  current: DiscountChoice<R>,
  pick: { kind: "reward"; reward: R } | { kind: "promo"; code: string },
  policy: DiscountPolicy,
): DiscountChoice<R> & { removedPromo: string | null; removedRewards: R[] } {
  const max = Math.max(0, policy.maxRewardsPerOrder);

  if (pick.kind === "promo") {
    const removedRewards = policy.allowPromoWithReward ? [] : [...current.rewards];
    return {
      promoCode: pick.code,
      rewards: policy.allowPromoWithReward ? current.rewards : [],
      removedPromo: current.promoCode && current.promoCode !== pick.code ? current.promoCode : null,
      removedRewards,
    };
  }

  if (max === 0) return { ...current, removedPromo: null, removedRewards: [pick.reward] };
  const kept = [...current.rewards, pick.reward];
  const removedRewards = kept.splice(0, Math.max(0, kept.length - max));
  const dropPromo = current.promoCode !== null && !policy.allowPromoWithReward;
  return {
    promoCode: dropPromo ? null : current.promoCode,
    rewards: kept,
    removedPromo: dropPromo ? current.promoCode : null,
    removedRewards,
  };
}

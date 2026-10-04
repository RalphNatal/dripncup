/**
 * The checkout's reward logic that is not arithmetic: which requested
 * rewards may be priced at all, what the customer is told when one cannot be
 * used, and the "Use a reward" list with each reward marked usable or not
 * (and why). Pure; the checkout service feeds it database rows and the
 * engine's priced lines.
 */
import { formatCents } from "@/lib/money";
import {
  discountConflict,
  rewardCandidates,
  type DiscountPolicy,
  type RewardEvaluation,
  type RewardFailure,
  type RewardLine,
  type RewardRequest,
} from "@/lib/pricing";

import type { AppliedRewardView, RewardOptionView } from "@/lib/checkout/types";

import { formatPoints, rewardLabel, tierDetails, type RewardTier } from "./model";

export interface RewardChoiceInput {
  rewardId: string;
  lineId?: string | null;
}

export interface Rejection {
  rewardId: string;
  message: string;
}

export const PROMO_WITH_REWARD_MESSAGE = "Use either a promo code or a reward on this order, not both.";

function rewardsPerOrder(max: number): string {
  return max === 1 ? "one reward" : `${max} rewards`;
}

function needsLabel(tier: RewardTier): string {
  if (tier.eligibilityLabel) return tier.eligibilityLabel;
  return tier.type === "free_modifier" ? "an eligible add-on" : "an eligible item";
}

export function shortOfPointsMessage(tier: Pick<RewardTier, "name">, short: number, balance: number): string {
  if (balance < 0) return `Your balance is below zero after a refund, so rewards are paused until you earn more.`;
  return `You need ${short.toLocaleString("en-US")} more ${short === 1 ? "point" : "points"} for ${tier.name}.`;
}

/**
 * Which requested rewards get priced. Unknown or switched-off rewards, any
 * beyond the per-order limit, and any the customer cannot afford (in the
 * order chosen) are rejected with a reason. A promo alongside a reward,
 * under the one-discount rule, blocks checkout without pricing the rewards:
 * the page never sends both, so this is a stale or crafted request.
 */
export function resolveRewardChoices(
  choices: readonly RewardChoiceInput[],
  tiers: readonly RewardTier[],
  { spendable, balance, hasPromo, policy }: { spendable: number; balance: number; hasPromo: boolean; policy: DiscountPolicy },
): { requests: RewardRequest[]; tiers: RewardTier[]; rejected: Rejection[]; blocked: string | null } {
  const byId = new Map(tiers.map((tier) => [tier.id, tier]));
  const rejected: Rejection[] = [];
  const known: { tier: RewardTier; lineId: string | null }[] = [];

  for (const choice of choices) {
    const tier = byId.get(choice.rewardId);
    if (tier) known.push({ tier, lineId: choice.lineId ?? null });
    else rejected.push({ rewardId: choice.rewardId, message: "That reward isn't available any more." });
  }

  const max = Math.max(0, policy.maxRewardsPerOrder);
  if (discountConflict({ hasPromo: false, rewardCount: known.length }, policy)) {
    for (const extra of known.splice(max)) {
      rejected.push({ rewardId: extra.tier.id, message: `Only ${rewardsPerOrder(max)} can be used per order.` });
    }
  }

  if (discountConflict({ hasPromo, rewardCount: known.length }, policy)?.code === "promo_with_reward") {
    return { requests: [], tiers: [], rejected, blocked: PROMO_WITH_REWARD_MESSAGE };
  }

  let left = spendable;
  const kept: typeof known = [];
  for (const choice of known) {
    if (choice.tier.pointsCost > left) {
      rejected.push({ rewardId: choice.tier.id, message: shortOfPointsMessage(choice.tier, choice.tier.pointsCost - left, balance) });
      continue;
    }
    left -= choice.tier.pointsCost;
    kept.push(choice);
  }

  return {
    requests: kept.map(({ tier, lineId }) => ({ reward: tier, lineId })),
    tiers: kept.map(({ tier }) => tier),
    rejected,
    blocked: null,
  };
}

export function rewardFailureMessage(reason: RewardFailure, tier: RewardTier): string {
  switch (reason) {
    case "no_eligible_line":
      return `${tier.name} needs ${needsLabel(tier)} in your order.`;
    case "line_not_eligible":
      return `${tier.name} can't be used on that item. Choose another.`;
    case "nothing_to_discount":
      return `There's nothing left on this order for ${tier.name} to take off.`;
  }
}

/** The engine's verdicts as the page shows them: what applied, and what didn't (with why). */
export function appliedRewards(evaluations: readonly RewardEvaluation[], tiers: readonly RewardTier[]): { applied: AppliedRewardView[]; rejected: Rejection[] } {
  const applied: AppliedRewardView[] = [];
  const rejected: Rejection[] = [];
  evaluations.forEach((evaluation, index) => {
    const tier = tiers[index];
    if (!evaluation.ok) {
      rejected.push({ rewardId: tier.id, message: rewardFailureMessage(evaluation.reason, tier) });
      return;
    }
    applied.push({
      rewardId: tier.id,
      name: tier.name,
      type: tier.type,
      pointsCost: tier.pointsCost,
      lineId: evaluation.lineId,
      label: rewardLabel({ name: tier.name, type: tier.type, productName: evaluation.productName, optionName: evaluation.optionName }),
      discountCents: evaluation.discountCents,
    });
  });
  return { applied, rejected };
}

/**
 * The "Use a reward" list: every active tier, marked usable on this cart or
 * not, and why. `spendable` counts points this browser's own unfinished
 * attempt is holding. Picking a reward when the order already has as many
 * as allowed replaces the oldest, so that one's points count as free.
 */
export function rewardOptions({
  tiers,
  lines,
  lineLabels,
  applied,
  spendable,
  balance,
  heldPoints,
  policy,
  amountOffRoomCents,
}: {
  tiers: readonly RewardTier[];
  lines: readonly RewardLine[];
  /** Cart line id -> "Latte · Medium". */
  lineLabels: ReadonlyMap<string, string>;
  applied: readonly AppliedRewardView[];
  spendable: number;
  balance: number;
  /** Held by other unfinished checkouts. */
  heldPoints: number;
  policy: DiscountPolicy;
  /** What an amount-off reward could take off (subtotal, less a promo when stacking). */
  amountOffRoomCents: number;
}): RewardOptionView[] {
  const max = Math.max(0, policy.maxRewardsPerOrder);
  const appliedCost = applied.reduce((sum, r) => sum + r.pointsCost, 0);

  return tiers.map((tier): RewardOptionView => {
    const isApplied = applied.some((r) => r.rewardId === tier.id);
    let available = spendable - appliedCost;
    if (isApplied) available += tier.pointsCost;
    else if (applied.length >= max && applied.length > 0) available += applied[0].pointsCost;
    const affordable = max > 0 && tier.pointsCost <= available;

    const candidates = rewardCandidates(tier, lines);
    const eligible = tier.type === "amount_off" ? amountOffRoomCents > 0 : candidates.length > 0;
    const valueCents =
      tier.type === "amount_off"
        ? Math.min(tier.valueCents ?? 0, Math.max(0, amountOffRoomCents))
        : (candidates[0]?.valueCents ?? null);

    let unavailableReason: string | null = null;
    if (max === 0) unavailableReason = "Rewards can't be used on online orders right now.";
    else if (!affordable) {
      unavailableReason = shortOfPointsMessage(tier, tier.pointsCost - Math.max(0, available), balance);
      if (heldPoints > 0 && balance >= 0) unavailableReason += ` ${formatPoints(heldPoints)} are held by an unfinished checkout.`;
    } else if (!eligible) {
      unavailableReason =
        tier.type === "amount_off" ? "There's nothing on this order to take off." : `Add ${needsLabel(tier)} to use this reward.`;
    }

    return {
      id: tier.id,
      name: tier.name,
      details: tierDetails(tier),
      type: tier.type,
      pointsCost: tier.pointsCost,
      affordable,
      eligible,
      unavailableReason,
      valueCents,
      lines: candidates.map((c) => {
        const line = lineLabels.get(c.lineId) ?? c.productName;
        return { lineId: c.lineId, label: c.optionName ? `${c.optionName} on ${line}` : line, valueCents: c.valueCents };
      }),
    };
  });
}

/** "Worth $6.25 on this order". */
export function worthLabel(valueCents: number | null): string | null {
  return valueCents === null || valueCents <= 0 ? null : `Worth ${formatCents(valueCents)} on this order`;
}

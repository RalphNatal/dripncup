"use client";

/**
 * "Use a reward" on /checkout. Lists every Overflow Rewards tier with what it
 * would take off this order, marked usable or not (and why). Everything here
 * comes from the server's quote; choosing a reward only changes what the
 * next quote asks for, and the server prices it again.
 */
import { Check, Gift, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";

import type { CheckoutRewards } from "@/lib/checkout/types";
import { formatCents } from "@/lib/money";
import { formatPoints } from "@/lib/rewards/model";
import { cn } from "@/lib/utils";

export interface RewardChoiceState {
  rewardId: string;
  lineId: string | null;
}

export function RewardPicker({
  rewards,
  choices,
  pending,
  notice,
  onUse,
  onRemove,
  onChooseLine,
  onRelease,
}: {
  rewards: CheckoutRewards | null;
  choices: readonly RewardChoiceState[];
  /** A choice is waiting for the server's next quote. */
  pending: boolean;
  /** Why something was swapped out or refused, from the last change. */
  notice: string | null;
  onUse: (rewardId: string) => void;
  onRemove: (rewardId: string) => void;
  onChooseLine: (rewardId: string, lineId: string) => void;
  /** Cancels the customer's other unfinished checkouts to free their points. */
  onRelease: () => Promise<void>;
}) {
  const ids = useId();
  const [releasing, setReleasing] = useState(false);

  if (!rewards) return null;
  const chosen = new Set(choices.map((c) => c.rewardId));

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm">
        <Sparkles className="size-4 text-brand-magenta-deep" aria-hidden="true" />
        <span>
          You have <span className="font-bold tabular" data-testid="checkout-balance">{formatPoints(rewards.balance)}</span>
        </span>
      </p>

      {notice ? (
        <p role="status" data-testid="reward-notice" className="rounded-xl border border-brand-teal-deep/30 bg-brand-teal-soft px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}

      {rewards.heldPoints > 0 ? (
        <div className="rounded-xl bg-muted px-3 py-2 text-sm" data-testid="held-points">
          <p>
            {formatPoints(rewards.heldPoints)} {rewards.heldPoints === 1 ? "is" : "are"} held by an unfinished checkout.
            They come back on their own when it expires.
          </p>
          <button
            type="button"
            disabled={releasing}
            onClick={async () => {
              setReleasing(true);
              try {
                await onRelease();
              } finally {
                setReleasing(false);
              }
            }}
            className="focus-ring mt-1 inline-flex min-h-11 items-center gap-2 rounded-full font-semibold text-brand-teal-deep underline underline-offset-2 disabled:opacity-60"
          >
            {releasing ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            Cancel that checkout and use them now
          </button>
        </div>
      ) : null}

      {rewards.options.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rewards are available right now.</p>
      ) : (
        <ul className="space-y-2" aria-label="Rewards">
          {rewards.options.map((option) => {
            const applied = rewards.applied.find((a) => a.rewardId === option.id);
            const isChosen = chosen.has(option.id);
            const usable = option.affordable && option.eligible;
            const choice = choices.find((c) => c.rewardId === option.id);
            const reasonId = `${ids}-${option.id}-reason`;
            return (
              <li
                key={option.id}
                data-testid="reward-option"
                data-reward={option.name}
                data-state={applied ? "applied" : usable ? "available" : "unavailable"}
                className={cn(
                  "rounded-2xl border p-3",
                  applied ? "border-brand-magenta-deep bg-brand-pink-soft" : usable ? "bg-card" : "bg-muted/40",
                )}
              >
                <div className="flex items-start gap-3">
                  <Gift
                    className={cn("mt-0.5 size-5 shrink-0", usable || applied ? "text-brand-magenta-deep" : "text-muted-foreground")}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">
                      {option.name}{" "}
                      <span className="text-sm font-semibold text-muted-foreground tabular">· {formatPoints(option.pointsCost)}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">{option.details}</p>
                    {applied ? (
                      <p className="mt-1 text-sm font-semibold text-brand-magenta-deep">
                        {applied.label} · <span className="tabular">−{formatCents(applied.discountCents)}</span>
                      </p>
                    ) : usable && option.valueCents ? (
                      <p className="mt-1 text-sm">Worth {formatCents(option.valueCents)} on this order</p>
                    ) : null}
                    {!usable && !applied && option.unavailableReason ? (
                      <p id={reasonId} className="mt-1 text-sm font-medium" data-testid="reward-reason">
                        {option.unavailableReason}
                      </p>
                    ) : null}
                    {applied && option.lines.length > 1 ? (
                      <div className="mt-2">
                        <label htmlFor={`${ids}-${option.id}-line`} className="text-sm font-semibold">
                          Apply to
                        </label>
                        <select
                          id={`${ids}-${option.id}-line`}
                          value={choice?.lineId ?? applied.lineId ?? option.lines[0].lineId}
                          onChange={(event) => onChooseLine(option.id, event.target.value)}
                          className="focus-ring mt-1 block h-11 w-full rounded-xl border bg-card px-3 text-base"
                        >
                          {option.lines.map((line) => (
                            <option key={line.lineId} value={line.lineId}>
                              {line.label} (−{formatCents(line.valueCents)})
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                  {isChosen ? (
                    <button
                      type="button"
                      onClick={() => onRemove(option.id)}
                      aria-label={`Remove ${option.name}`}
                      className="focus-ring inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border bg-card px-4 text-sm font-semibold hover:bg-muted"
                    >
                      {applied ? <Check className="size-4 text-brand-magenta-deep" aria-hidden="true" /> : null}
                      {applied ? "Remove" : pending ? <LoaderCircle className="size-4 animate-spin" aria-label="Checking" /> : "Remove"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!usable}
                      onClick={() => onUse(option.id)}
                      aria-describedby={!usable && option.unavailableReason ? reasonId : undefined}
                      aria-label={`Use ${option.name}`}
                      className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-full bg-brand-magenta-deep px-4 text-sm font-bold text-white hover:bg-brand-magenta-deep/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                    >
                      Use
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        {rewards.policy.maxRewardsPerOrder === 1 ? "One reward per order. " : `Up to ${rewards.policy.maxRewardsPerOrder} rewards per order. `}
        {rewards.policy.allowPromoWithReward ? "Rewards work with promo codes." : "A reward can't be combined with a promo code."}{" "}
        <Link href="/rewards" className="font-semibold underline underline-offset-2">
          How {rewards.programName} works
        </Link>
      </p>
    </div>
  );
}

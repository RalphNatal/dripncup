/**
 * Every active tier: what it costs, what it covers, and -- for a signed-in
 * customer -- whether they can redeem it now.
 */
import { Check, Gift } from "lucide-react";

import { formatPoints, tierDetails, type RewardTier } from "@/lib/rewards/model";
import { cn } from "@/lib/utils";

export function TierList({ tiers, balance }: { tiers: readonly RewardTier[]; balance: number | null }) {
  if (tiers.length === 0) return <p className="text-sm text-muted-foreground">Rewards are on their way.</p>;
  return (
    <ul className="space-y-3" aria-label="Reward tiers">
      {tiers.map((tier) => {
        const affordable = balance !== null && balance >= tier.pointsCost;
        return (
          <li
            key={tier.id}
            data-testid="reward-tier"
            data-affordable={balance === null ? undefined : String(affordable)}
            className={cn("flex gap-3 rounded-2xl border p-4", affordable ? "border-brand-magenta-deep bg-brand-pink-soft" : "bg-card")}
          >
            <div
              className={cn(
                "flex size-14 shrink-0 flex-col items-center justify-center rounded-2xl text-center leading-none",
                affordable ? "bg-brand-magenta-deep text-white" : "bg-muted",
              )}
            >
              <span className="text-lg font-extrabold tabular">{tier.pointsCost}</span>
              <span className="text-[0.65rem] font-semibold uppercase">pts</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-bold">
                <Gift className="size-4 text-brand-magenta-deep" aria-hidden="true" />
                {tier.name}
              </p>
              {tier.description ? <p className="text-sm">{tier.description}</p> : null}
              <p className="text-sm text-muted-foreground">{tierDetails(tier)}</p>
              {balance !== null ? (
                <p className="mt-1 text-sm font-semibold">
                  {affordable ? (
                    <span className="inline-flex items-center gap-1 text-brand-magenta-deep">
                      <Check className="size-4" aria-hidden="true" />
                      You can redeem this at checkout
                    </span>
                  ) : (
                    <span>{formatPoints(tier.pointsCost - Math.max(0, balance))} to go</span>
                  )}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

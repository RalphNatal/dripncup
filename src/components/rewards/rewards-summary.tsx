/**
 * Balance and progress towards the next tier: the rewards page header and
 * the Home greeting. The balance is the ledger's cached sum, from the server.
 */
import { formatPoints, type TierProgress } from "@/lib/rewards/model";
import { cn } from "@/lib/utils";

export function ProgressBar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-3 w-full overflow-hidden rounded-full bg-white/70 ring-1 ring-brand-magenta-deep/20", className)}
    >
      <div className="h-full rounded-full bg-brand-magenta-deep transition-[width]" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** "30 points to Free drink", "You can redeem every reward". */
export function progressText(balance: number, progress: TierProgress): string {
  if (balance < 0) return "Your balance went below zero after a refund. New orders will bring it back up.";
  if (!progress.next) return progress.affordableCount > 0 ? "You can redeem every reward. Treat yourself!" : "No rewards to show yet.";
  return `${formatPoints(progress.pointsToNext)} to ${progress.next.name}`;
}

export function RewardsSummary({
  balance,
  progress,
  heldPoints = 0,
  compact = false,
}: {
  balance: number;
  progress: TierProgress;
  heldPoints?: number;
  compact?: boolean;
}) {
  return (
    <div>
      <p className={cn("font-extrabold tabular", compact ? "text-2xl" : "text-5xl")} data-testid="points-balance">
        {balance.toLocaleString("en-US")}
        <span className={cn("ml-1.5 font-semibold text-foreground/70", compact ? "text-base" : "text-lg")}>
          {Math.abs(balance) === 1 ? "point" : "points"}
        </span>
      </p>
      <ProgressBar
        percent={progress.percent}
        label={progress.next ? `Progress to ${progress.next.name}` : "Rewards progress"}
        className="mt-2"
      />
      <p className="mt-1.5 text-sm font-medium" data-testid="points-progress">
        {progressText(balance, progress)}
      </p>
      {heldPoints > 0 ? (
        <p className="mt-1 text-sm text-foreground/70">
          {formatPoints(heldPoints)} held by an unfinished checkout; they come back if it isn&apos;t paid.
        </p>
      ) : null}
    </div>
  );
}

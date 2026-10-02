import { Check, CircleX, Undo2 } from "lucide-react";

import type { Timeline } from "@/lib/orders/timeline";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Placed → Accepted → Preparing → Ready → Picked Up, with times; then how it ended, if it ended early. */
export function OrderTimeline({ timeline }: { timeline: Timeline }) {
  const steps = timeline.outcome ? timeline.steps.filter((s) => s.state !== "skipped") : timeline.steps;

  return (
    <div>
      <ol className="space-y-0" aria-label="Order progress">
        {steps.map((step, index) => {
          const last = index === steps.length - 1 && !timeline.outcome;
          const reached = step.state === "done" || step.state === "current";
          return (
            <li key={step.status} className="relative flex gap-3 pb-5 last:pb-0" aria-current={step.state === "current" ? "step" : undefined}>
              {!last ? (
                <span
                  aria-hidden="true"
                  className={cn("absolute top-7 left-[13px] h-[calc(100%-1.75rem)] w-0.5", reached ? "bg-brand-teal-deep" : "bg-border")}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border-2",
                  step.state === "done" && "border-brand-teal-deep bg-brand-teal-deep text-white",
                  step.state === "current" &&
                    (step.status === "ready"
                      ? "border-brand-magenta-deep bg-brand-magenta-deep text-white"
                      : "border-brand-teal-deep bg-card text-brand-teal-deep"),
                  step.state === "upcoming" && "border-border bg-card",
                )}
              >
                {step.state === "done" ? <Check className="size-4" /> : null}
                {step.state === "current" ? <span className="size-2.5 animate-pulse rounded-full bg-current" /> : null}
              </span>
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3 pt-0.5">
                <span className={cn("font-semibold", step.state === "upcoming" && "text-muted-foreground")}>
                  {step.label}
                  {step.state === "current" ? <span className="sr-only"> (current)</span> : null}
                  {step.state === "upcoming" ? <span className="sr-only"> (not yet)</span> : null}
                </span>
                {step.at ? (
                  <time dateTime={step.at} className="tabular shrink-0 text-sm text-muted-foreground">
                    {formatCafeTimeOfDay(new Date(step.at))}
                  </time>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {timeline.outcome ? (
        <div className="mt-5 flex gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4" data-testid="order-outcome">
          {timeline.outcome.kind === "refunded" ? (
            <Undo2 className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          ) : (
            <CircleX className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 font-bold">
              {timeline.outcome.title}
              {timeline.outcome.at ? (
                <time dateTime={timeline.outcome.at} className="tabular text-sm font-normal text-muted-foreground">
                  {formatCafeTimeOfDay(new Date(timeline.outcome.at))}
                </time>
              ) : null}
            </p>
            {timeline.outcome.reason ? <p className="mt-1">{timeline.outcome.reason}</p> : null}
            {timeline.outcome.refund ? <p className="mt-1 text-sm text-muted-foreground">{timeline.outcome.refund}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Pause online orders for a rush, with an optional automatic resume.
 *
 * The button is always on the header; while paused a banner across the
 * dashboard says so, counts down to the automatic resume, and offers
 * Resume. The pause goes through set_location_accepting_orders(); an
 * automatic resume needs no job, because every reader treats a pause whose
 * time has passed as over (isAcceptingOrders).
 */
import { PauseCircle, PlayCircle } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { formatElapsed } from "@/lib/staff/queue";

const OPTIONS = [
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "60 minutes", minutes: 60 },
  { label: "Until I resume", minutes: null },
] as const;

export function PauseButton({
  paused,
  busy,
  onPause,
  onResume,
}: {
  paused: boolean;
  busy: boolean;
  onPause: (minutes: number | null) => Promise<void>;
  onResume: () => Promise<void>;
}) {
  const [choosing, setChoosing] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (paused ? void onResume() : setChoosing(true))}
        className={cn(
          "focus-ring inline-flex min-h-14 items-center gap-2 rounded-xl px-4 text-lg font-extrabold disabled:opacity-60",
          paused ? "bg-brand-teal-deep text-white" : "border-2 border-warning bg-card text-warning",
        )}
      >
        {paused ? <PlayCircle className="size-6" aria-hidden="true" /> : <PauseCircle className="size-6" aria-hidden="true" />}
        {paused ? "Resume online orders" : "Pause online orders"}
      </button>

      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="sm:max-w-lg [&_[data-slot=dialog-close]]:size-14 [&_[data-slot=dialog-close]_svg]:size-7">
          <DialogTitle className="font-heading text-3xl font-extrabold">Pause online orders?</DialogTitle>
          <DialogDescription className="text-lg">
            Customers can keep browsing but can&apos;t check out. Orders already placed stay on the queue.
          </DialogDescription>
          <div className="grid gap-2 sm:grid-cols-2">
            {OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                disabled={busy}
                onClick={async () => {
                  await onPause(option.minutes);
                  setChoosing(false);
                }}
                className="focus-ring min-h-16 rounded-xl border-2 border-warning bg-card text-xl font-extrabold disabled:opacity-60"
              >
                {option.minutes ? `Pause ${option.label}` : option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setChoosing(false)}
            className="focus-ring min-h-14 rounded-xl text-lg font-bold underline"
          >
            Keep taking orders
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PausedBanner({
  pausedUntil,
  now,
  busy,
  onResume,
}: {
  pausedUntil: string | null;
  now: Date;
  busy: boolean;
  onResume: () => Promise<void>;
}) {
  const until = pausedUntil ? new Date(pausedUntil) : null;
  return (
    <div
      role="status"
      data-testid="paused-banner"
      className="flex flex-wrap items-center gap-3 rounded-2xl bg-warning px-5 py-3 text-white"
    >
      <PauseCircle className="size-8 shrink-0" aria-hidden="true" />
      <p className="flex-1 text-xl font-extrabold">
        Online orders are paused
        {until ? (
          <span className="font-bold">
            {" "}
            · resuming automatically in <span className="tabular">{formatElapsed(now, until)}</span> (
            {formatCafeTimeOfDay(until)})
          </span>
        ) : (
          <span className="font-bold"> until you resume them</span>
        )}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onResume()}
        className="focus-ring min-h-14 rounded-xl bg-white px-5 text-lg font-extrabold text-brand-ink disabled:opacity-60"
      >
        Resume now
      </button>
    </div>
  );
}

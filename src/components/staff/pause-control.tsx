"use client";

/**
 * Pause online orders for a rush, with an optional automatic resume.
 *
 * The button is always on the toolbar, filled amber and counting down while
 * paused; a banner across the dashboard says so too and offers Resume. The
 * pause goes through set_location_accepting_orders(); an automatic resume
 * needs no job, because every reader treats a pause whose time has passed as
 * over (isAcceptingOrders).
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
  pausedUntil,
  now,
  busy,
  variant = "toolbar",
  onPause,
  onResume,
}: {
  paused: boolean;
  pausedUntil: string | null;
  now: Date;
  busy: boolean;
  /**
   * toolbar: the full label, shortened to "Pause" / "Resume" between 1024
   * and 1536 px where the toolbar is tight; phone: always short. The
   * accessible name always says it in full.
   */
  variant?: "toolbar" | "phone";
  onPause: (minutes: number | null) => Promise<void>;
  onResume: () => Promise<void>;
}) {
  const [choosing, setChoosing] = useState(false);
  const until = pausedUntil ? new Date(pausedUntil) : null;
  const phone = variant === "phone";
  const label = (full: string, short: string) =>
    phone ? (
      short
    ) : (
      <>
        <span className="md:max-2xl:hidden">{full}</span>
        <span className="hidden md:max-2xl:inline">{short}</span>
      </>
    );

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (paused ? void onResume() : setChoosing(true))}
        aria-label={paused ? "Resume online orders" : "Pause online orders"}
        data-testid="pause-button"
        data-paused={paused ? "true" : "false"}
        className={cn(
          "focus-ring inline-flex min-h-14 shrink-0 items-center gap-2 rounded-xl font-extrabold whitespace-nowrap disabled:opacity-60",
          phone ? "px-3 text-base" : "px-4 text-lg md:max-2xl:px-3 md:max-2xl:text-base",
          // Icon over label where the toolbar is tight, like the buttons beside it.
          !phone &&
            !paused &&
            "md:max-2xl:min-w-[4.25rem] md:max-2xl:flex-col md:max-2xl:justify-center md:max-2xl:gap-0.5 md:max-2xl:px-2 md:max-2xl:text-sm",
          paused ? "bg-staff-fill-warn text-white" : "border-2 border-staff-warn/60 bg-staff-card text-staff-warn",
        )}
      >
        {paused ? <PlayCircle className="size-6 shrink-0" aria-hidden="true" /> : <PauseCircle className="size-6 shrink-0" aria-hidden="true" />}
        {paused ? (
          <span className="flex flex-col items-start leading-tight">
            <span>{label("Resume online orders", "Resume")}</span>
            <span className="tabular text-sm font-semibold opacity-90">
              Paused{until ? ` · ${formatElapsed(now, until)}` : ""}
            </span>
          </span>
        ) : (
          <span>{label("Pause online orders", "Pause")}</span>
        )}
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
                className="focus-ring min-h-16 rounded-xl border-2 border-staff-warn/60 bg-card text-xl font-extrabold disabled:opacity-60"
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
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-l-[6px] border-staff-warn bg-staff-warn-soft py-1 pr-1 pl-4"
    >
      <PauseCircle className="size-6 shrink-0 text-staff-warn" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-lg font-bold">
        Online orders are paused
        {until ? (
          <span className="font-semibold">
            {" "}
            · resuming automatically in <span className="tabular">{formatElapsed(now, until)}</span> ({formatCafeTimeOfDay(until)})
          </span>
        ) : (
          <span className="font-semibold"> until you resume them</span>
        )}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onResume()}
        className="focus-ring min-h-14 rounded-lg bg-staff-fill-warn px-5 text-lg font-extrabold text-white disabled:opacity-60"
      >
        Resume now
      </button>
    </div>
  );
}

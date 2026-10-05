"use client";

/**
 * A thin strip at the top of every page while local test mode
 * (TEST_STORE_ALWAYS_OPEN) is on, so nobody mistakes "always open" for the
 * real hours. It also shows what time it is in Honolulu, which is the clock
 * the app reasons with. The root layout renders it only when the server-side
 * guard says test mode is active.
 */
import { useSyncExternalStore } from "react";

import { formatCafeTimeOfDay, formatCafeWeekdayShort } from "@/lib/time";

// One shared clock that changes once a minute (checked every 5 seconds, so it
// turns over within a few seconds of the minute).
let minute: Date | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const floorToMinute = (date: Date) => new Date(Math.floor(date.getTime() / 60_000) * 60_000);

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  ticker ??= setInterval(() => {
    const now = floorToMinute(new Date());
    if (minute && now.getTime() === minute.getTime()) return;
    minute = now;
    listeners.forEach((l) => l());
  }, 5_000);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      clearInterval(ticker);
      ticker = undefined;
    }
  };
}

/** Null during the server render; the time appears once the page hydrates. */
function useMinute(): Date | null {
  return useSyncExternalStore(
    subscribe,
    () => (minute ??= floorToMinute(new Date())),
    () => null,
  );
}

export function TestModeBanner() {
  const now = useMinute();
  return (
    <div
      role="status"
      className="bg-amber-300 px-4 py-1 text-center text-xs font-semibold text-black"
      data-testid="test-mode-banner"
    >
      Test mode: store hours ignored
      {now ? ` · Honolulu time now: ${formatCafeTimeOfDay(now)} ${formatCafeWeekdayShort(now)}` : null}
    </div>
  );
}

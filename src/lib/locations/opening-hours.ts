/**
 * The one place opening hours enter the app.
 *
 * Every reader that loads `location_hours` and `closures` (the storefront,
 * checkout and the payment webhook, the staff dashboard) turns the rows into
 * hours through `openingHours()`. Everything that decides open or closed --
 * the header status, add-to-cart blocking, cart re-validation, pickup slots,
 * order creation, the webhook's after-payment re-check, the staff status and
 * the sold-out "until end of day" reset -- works from what this returns.
 *
 * That is how local test mode reaches all of them at once: with
 * `TEST_STORE_ALWAYS_OPEN` in force (see `@/lib/test-mode`), the stored
 * hours and closures are swapped for "open 24 hours, every day, no
 * closures". Pause, sold-out flags and event windows are not hours, so they
 * are untouched.
 */
import { storeAlwaysOpen } from "@/lib/test-mode";

import type { Closure, WeeklyHours } from "./status";

/** Midnight to midnight, every day. `24:00:00` is a valid Postgres `time` and means the end of the day. */
export const ALWAYS_OPEN_HOURS: readonly WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  dayOfWeek: day,
  opensAt: "00:00:00",
  closesAt: "24:00:00",
}));

type HoursRow = { day_of_week: number; opens_at: string; closes_at: string };
type ClosureRow = {
  location_id: string | null;
  closure_date: string;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
  reason: string | null;
};

export interface OpeningHours {
  hours: WeeklyHours[];
  closures: Closure[];
}

/**
 * One location's weekly hours and the closures that may apply to it, as the
 * status and pickup rules take them. `alwaysOpen` defaults to local test mode;
 * tests pass it explicitly.
 */
export function openingHours(
  hourRows: readonly HoursRow[] | null,
  closureRows: readonly ClosureRow[] | null,
  alwaysOpen: boolean = storeAlwaysOpen(),
): OpeningHours {
  if (alwaysOpen) return { hours: [...ALWAYS_OPEN_HOURS], closures: [] };
  return {
    hours: (hourRows ?? []).map((h) => ({ dayOfWeek: h.day_of_week, opensAt: h.opens_at, closesAt: h.closes_at })),
    closures: (closureRows ?? []).map((c) => ({
      locationId: c.location_id,
      date: c.closure_date,
      isClosed: c.is_closed,
      opensAt: c.opens_at,
      closesAt: c.closes_at,
      reason: c.reason,
    })),
  };
}

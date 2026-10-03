/**
 * When an "until end of day" sold-out flag resets itself.
 *
 * The answer is the start of the location's next trading day: the first
 * opening that falls on a later Honolulu date than today. Marked at 2 PM,
 * or at 6 AM before a 6:30 open, it resets at the next day's opening; a
 * split day's afternoon service does not reset it. Closures and holiday
 * hours are respected, so a flag set on Saturday before a Sunday closure
 * resets on Monday morning.
 *
 * Pop-ups have no weekly hours: their flags reset at the next Honolulu
 * midnight, as do a cafe's when it has no opening in the lookahead.
 *
 * Pure (Honolulu time via @/lib/time); the result is stored as
 * location_availability.available_from, which every menu reader already
 * honours.
 */
import { openIntervalsOn, type Closure, type WeeklyHours } from "@/lib/locations/status";
import { addDays, cafeDateKey, startOfCafeDay } from "@/lib/time";

/** As far ahead as status.ts looks for the next opening. */
const LOOKAHEAD_DAYS = 15;

export function endOfDayResetAt({
  location,
  hours,
  closures,
  now,
}: {
  location: { id: string; type: "cafe" | "event" };
  hours: readonly WeeklyHours[];
  closures: readonly Closure[];
  now: Date;
}): Date {
  const tomorrow = addDays(startOfCafeDay(now), 1);
  if (location.type === "event") return tomorrow;

  const today = cafeDateKey(now);
  for (let offset = 1; offset <= LOOKAHEAD_DAYS; offset += 1) {
    const day = addDays(startOfCafeDay(now), offset);
    const opening = openIntervalsOn(location.id, day, hours, closures)[0];
    if (opening && cafeDateKey(opening.start) !== today && opening.start > now) return opening.start;
  }
  return tomorrow;
}

export type SoldOutDuration = "end_of_day" | "until_back_on";

/** The `p_until` set_sold_out() takes: a reset time, or null for "until I turn it back on". */
export function soldOutUntil(
  duration: SoldOutDuration,
  input: Parameters<typeof endOfDayResetAt>[0],
): string | null {
  // A plain Date: the TZDate the time helpers return would print a -10:00 offset.
  return duration === "end_of_day" ? new Date(endOfDayResetAt(input).getTime()).toISOString() : null;
}

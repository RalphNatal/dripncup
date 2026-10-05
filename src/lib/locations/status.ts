/**
 * Is a location open right now, and if not, when does it open?
 *
 * Pure: everything, including `now`, is passed in, so the rules can be
 * tested at exact instants and the same code can re-check at checkout.
 * All reasoning is in Pacific/Honolulu time via `@/lib/time`, never the
 * server's or the phone's own timezone.
 *
 * Precedence, from strongest:
 *   1. Events are open only inside their starts_at / ends_at window.
 *   2. A closure row for the day (the location's own, else an all-locations
 *      one) replaces the weekly hours: closed all day, or holiday hours.
 *   3. Otherwise the weekly hours for that weekday; several rows = split hours.
 *   4. Within open hours, the staff pause toggle or the global
 *      "accepting online orders" switch makes the location Paused.
 *
 * Hours and closures arrive through `openingHours()` (./opening-hours), which
 * is where local test mode swaps in "open 24 hours"; nothing here knows
 * about the flag.
 */
import {
  addDays,
  cafeDateAtTime,
  cafeDateKey,
  cafeDayOfWeek,
  formatCafeMonthDay,
  formatCafeTimeOfDay,
  formatCafeWeekdayShort,
  startOfCafeDay,
} from "@/lib/time";

export interface StatusLocation {
  id: string;
  type: "cafe" | "event";
  /** The staff "pause online orders" toggle; false = paused. */
  acceptingOrders: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

/** A `location_hours` row. */
export interface WeeklyHours {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

/** A `closures` row. A null locationId applies to every location. */
export interface Closure {
  locationId: string | null;
  /** "YYYY-MM-DD", a Honolulu calendar date. */
  date: string;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  reason: string | null;
}

export interface StatusInput {
  location: StatusLocation;
  hours: readonly WeeklyHours[];
  closures: readonly Closure[];
  now: Date;
  /** The global `orders.accepting_online_orders` setting. */
  onlineOrderingEnabled?: boolean;
}

export type LocationStatus =
  | { kind: "open"; canOrder: true; closesAt: Date }
  | { kind: "paused"; canOrder: false; closesAt: Date }
  | { kind: "closed"; canOrder: false; opensAt: Date | null }
  | { kind: "event"; canOrder: false; phase: "upcoming" | "ended"; startsAt: Date; endsAt: Date };

interface Interval {
  start: Date;
  end: Date;
}

/**
 * Whether the staff pause toggle lets orders through at `now`. A pause with
 * `paused_until` in the past has run out: it resumes by itself, without a
 * job flipping the column back, so every reader must ask through here.
 */
export function isAcceptingOrders(acceptingOrders: boolean, pausedUntil: string | null, now: Date): boolean {
  if (acceptingOrders) return true;
  if (!pausedUntil) return false;
  const until = new Date(pausedUntil).getTime();
  return !Number.isNaN(until) && until <= now.getTime();
}

/** How far ahead to look for the next opening before just saying "Closed". */
const LOOKAHEAD_DAYS = 14;

/** Honolulu has no daylight saving, so every day is exactly this long. */
const DAY_MS = 86_400_000;

/** The closure row that governs `dateKey`, if any: the location's own beats all-locations. */
export function closureFor(locationId: string, dateKey: string, closures: readonly Closure[]): Closure | null {
  return (
    closures.find((c) => c.date === dateKey && c.locationId === locationId) ??
    closures.find((c) => c.date === dateKey && c.locationId === null) ??
    null
  );
}

/**
 * Open intervals on the Honolulu day containing `day`, closures applied.
 * Rows that touch or overlap are merged, so 10-2 and 2-6 read as 10-6.
 * A closing time of 24:00 is the following midnight.
 */
export function openIntervalsOn(
  locationId: string,
  day: Date,
  hours: readonly WeeklyHours[],
  closures: readonly Closure[],
): Interval[] {
  const closure = closureFor(locationId, cafeDateKey(day), closures);

  if (closure) {
    if (closure.isClosed || !closure.opensAt || !closure.closesAt) return [];
    return [{ start: cafeDateAtTime(day, closure.opensAt), end: cafeDateAtTime(day, closure.closesAt) }];
  }

  const weekday = cafeDayOfWeek(day);
  const sorted = hours
    .filter((h) => h.dayOfWeek === weekday)
    .map((h) => ({ start: cafeDateAtTime(day, h.opensAt), end: cafeDateAtTime(day, h.closesAt) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Where an open stretch really ends. A day that closes at midnight while the
 * next day opens at midnight (a 24-hour location, or local test mode) does
 * not close at all, so follow it day by day, up to the lookahead.
 */
export function openStretchEnd(
  locationId: string,
  end: Date,
  hours: readonly WeeklyHours[],
  closures: readonly Closure[],
): Date {
  let current = end;
  for (let day = 0; day < LOOKAHEAD_DAYS; day += 1) {
    const next = openIntervalsOn(locationId, current, hours, closures).find(
      (i) => i.start.getTime() === current.getTime(),
    );
    if (!next) break;
    current = next.end;
  }
  return current;
}

/** The next opening strictly after `now`, or null if none within the lookahead. */
export function nextOpening(
  locationId: string,
  now: Date,
  hours: readonly WeeklyHours[],
  closures: readonly Closure[],
): Date | null {
  const today = startOfCafeDay(now);
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset += 1) {
    const day = addDays(today, offset);
    const upcoming = openIntervalsOn(locationId, day, hours, closures).find((i) => i.start > now);
    if (upcoming) return upcoming.start;
  }
  return null;
}

export function getLocationStatus({
  location,
  hours,
  closures,
  now,
  onlineOrderingEnabled = true,
}: StatusInput): LocationStatus {
  const paused = !location.acceptingOrders || !onlineOrderingEnabled;

  // Events: the window is the opening hours.
  if (location.type === "event") {
    const startsAt = location.startsAt ? new Date(location.startsAt) : null;
    const endsAt = location.endsAt ? new Date(location.endsAt) : null;
    if (!startsAt || !endsAt) return { kind: "closed", canOrder: false, opensAt: null };

    if (now < startsAt) return { kind: "event", canOrder: false, phase: "upcoming", startsAt, endsAt };
    if (now >= endsAt) return { kind: "event", canOrder: false, phase: "ended", startsAt, endsAt };
    return paused
      ? { kind: "paused", canOrder: false, closesAt: endsAt }
      : { kind: "open", canOrder: true, closesAt: endsAt };
  }

  // Open means opensAt <= now < closesAt: at 4:00:00 PM a 4 PM close is closed.
  const current = openIntervalsOn(location.id, now, hours, closures).find(
    (i) => i.start <= now && now < i.end,
  );

  if (!current) {
    return { kind: "closed", canOrder: false, opensAt: nextOpening(location.id, now, hours, closures) };
  }

  const closesAt = openStretchEnd(location.id, current.end, hours, closures);
  return paused ? { kind: "paused", canOrder: false, closesAt } : { kind: "open", canOrder: true, closesAt };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

/** "Oct 8, 10:00 AM – 3:00 PM", or "Oct 8 – Oct 10" for a multi-day event. */
export function formatEventWindow(startsAt: Date, endsAt: Date): string {
  if (cafeDateKey(startsAt) === cafeDateKey(endsAt)) {
    return `${formatCafeMonthDay(startsAt)}, ${formatCafeTimeOfDay(startsAt)} – ${formatCafeTimeOfDay(endsAt)}`;
  }
  return `${formatCafeMonthDay(startsAt)} – ${formatCafeMonthDay(endsAt)}`;
}

/** "6:30 AM", "Fri 6:30 AM", or "Oct 8, 6:30 AM" -- the nearer, the shorter. */
function formatOpening(opensAt: Date, now: Date): string {
  const time = formatCafeTimeOfDay(opensAt);
  if (cafeDateKey(opensAt) === cafeDateKey(now)) return time;
  const daysAway = Math.round((startOfCafeDay(opensAt).getTime() - startOfCafeDay(now).getTime()) / 86_400_000);
  return daysAway < 7 ? `${formatCafeWeekdayShort(opensAt)} ${time}` : `${formatCafeMonthDay(opensAt)}, ${time}`;
}

/**
 * The short status shown in the header and location list:
 * "Open", "Closed · Opens Fri 6:30 AM", "Paused", "Event · Oct 8, 10:00 AM – 3:00 PM".
 */
export function statusLabel(status: LocationStatus, now: Date): string {
  switch (status.kind) {
    case "open":
      return "Open";
    case "paused":
      return "Paused";
    case "closed":
      return status.opensAt ? `Closed · Opens ${formatOpening(status.opensAt, now)}` : "Closed";
    case "event":
      return status.phase === "ended" ? "Event ended" : `Event · ${formatEventWindow(status.startsAt, status.endsAt)}`;
  }
}

/** A second line of detail, e.g. "Until 4:00 PM", or "Open 24 hours" when it doesn't close within a day. */
export function statusDetail(status: LocationStatus, now?: Date): string | null {
  switch (status.kind) {
    case "open":
      if (now && status.closesAt.getTime() - now.getTime() >= DAY_MS) return "Open 24 hours";
      return `Until ${formatCafeTimeOfDay(status.closesAt)}`;
    case "paused":
      return "Online ordering is paused for a moment";
    default:
      return null;
  }
}

/**
 * Why ordering is unavailable, in a sentence for banners and the disabled
 * Add to Cart button. Null when the location can take orders.
 */
export function orderingUnavailableReason(status: LocationStatus, locationName: string, now: Date): string | null {
  switch (status.kind) {
    case "open":
      return null;
    case "paused":
      return `${locationName} has paused online orders for a few minutes while the team catches up. You can keep browsing.`;
    case "closed":
      return status.opensAt
        ? `${locationName} is closed right now. Ordering opens ${formatOpening(status.opensAt, now)}.`
        : `${locationName} is closed right now.`;
    case "event":
      return status.phase === "upcoming"
        ? `Pre-orders for ${locationName} open when the event starts: ${formatEventWindow(status.startsAt, status.endsAt)}.`
        : `${locationName} has ended.`;
  }
}

/** Today's opening hours as text, e.g. "6:30 AM – 4:00 PM" or "Closed today". */
export function todaysHoursText({ location, hours, closures, now }: Omit<StatusInput, "onlineOrderingEnabled">): {
  hours: string;
  note: string | null;
} {
  if (location.type === "event" && location.startsAt && location.endsAt) {
    return { hours: formatEventWindow(new Date(location.startsAt), new Date(location.endsAt)), note: null };
  }

  const closure = closureFor(location.id, cafeDateKey(now), closures);
  const intervals = openIntervalsOn(location.id, now, hours, closures);
  const allDay = intervals.some((i) => i.end.getTime() - i.start.getTime() >= DAY_MS);
  const text = allDay
    ? "Open 24 hours"
    : intervals.length
      ? intervals.map((i) => `${formatCafeTimeOfDay(i.start)} – ${formatCafeTimeOfDay(i.end)}`).join(", ")
      : "Closed today";

  const note = closure ? (closure.reason ?? (closure.isClosed ? "Closed today" : "Holiday hours")) : null;
  return { hours: text, note: note === text ? null : note };
}


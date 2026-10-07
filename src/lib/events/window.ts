/**
 * Pop-up event windows, pure. An event row is one day of a pop-up (a
 * multi-day market is several rows, made with "Duplicate to another date"),
 * open for pre-orders only between its start and end.
 */
import { cafeDateKey, cafeInstant, toCafeTime } from "@/lib/time";

/** One event row covers at most this long (the database checks the same). */
export const MAX_EVENT_HOURS = 24;

export type EventPhase = "upcoming" | "live" | "past";

export function eventPhase(event: { startsAt: string | Date; endsAt: string | Date }, now: Date): EventPhase {
  const start = new Date(event.startsAt).getTime();
  const end = new Date(event.endsAt).getTime();
  if (now.getTime() >= end) return "past";
  if (now.getTime() >= start) return "live";
  return "upcoming";
}

export type EventWindowProblem = "missing" | "end_before_start" | "too_long";

/** Why an event window cannot be saved, or null. */
export function eventWindowProblem(startsAt: Date | null, endsAt: Date | null): EventWindowProblem | null {
  if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return "missing";
  if (endsAt.getTime() <= startsAt.getTime()) return "end_before_start";
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_HOURS * 60 * 60 * 1000) return "too_long";
  return null;
}

export const EVENT_WINDOW_MESSAGES: Record<EventWindowProblem, string> = {
  missing: "Enter a start and an end.",
  end_before_start: "The event must end after it starts.",
  too_long: "One event covers one day. For a multi-day market, save this day, then use “Duplicate to another date”.",
};

/**
 * The same event on another Honolulu date: same wall-clock start and the
 * same length (so a 5 PM - 1 AM night market stays one). Mirrors
 * admin_duplicate_event() in SQL.
 */
export function shiftEventToDate(
  event: { startsAt: Date; endsAt: Date },
  dateKey: string,
): { startsAt: Date; endsAt: Date } {
  const wall = toCafeTime(event.startsAt);
  const time = `${String(wall.getHours()).padStart(2, "0")}:${String(wall.getMinutes()).padStart(2, "0")}:${String(wall.getSeconds()).padStart(2, "0")}`;
  const startsAt = cafeInstant(dateKey, time);
  if (!startsAt) throw new RangeError(`Not a date: ${dateKey}`);
  return { startsAt, endsAt: new Date(startsAt.getTime() + (event.endsAt.getTime() - event.startsAt.getTime())) };
}

/** "kakaako-market" + "2026-10-18" -> "kakaako-market-2026-10-18" (any old date suffix replaced). */
export function eventSlug(base: string, dateKey: string): string {
  const stem = slugify(base).replace(/-\d{4}-\d{2}-\d{2}(-\d+)?$/, "").slice(0, 60).replace(/-+$/, "");
  return `${stem || "event"}-${dateKey}`;
}

/** Lowercase, ASCII, hyphenated: "Kakaʻako Market!" -> "kakaako-market". */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯʻ‘’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The Honolulu date an event starts on, as a key ("2026-10-18"). */
export function eventDateKey(startsAt: string | Date): string {
  return cafeDateKey(new Date(startsAt));
}

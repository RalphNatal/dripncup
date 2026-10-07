/**
 * Time in Hawaii.
 *
 * Vercel runs in UTC and the customer's phone could be anywhere, so nothing in
 * this app may rely on the ambient timezone. Store hours, pickup slots, event
 * windows and reports are all reasoned about in `Pacific/Honolulu`, which is
 * UTC-10 year round -- Hawaii does not observe daylight saving, so there are no
 * spring-forward gaps or repeated hours to handle.
 *
 * Instants are stored and passed around as UTC `Date` / `timestamptz`. This
 * module is the only place that converts between an instant and Hawaii wall
 * time.
 */
import { TZDate } from "@date-fns/tz";
import { addDays, addMinutes, differenceInMinutes, isAfter, isBefore } from "date-fns";

import { CAFE_TIMEZONE, LOCALE } from "@/lib/brand";

/** 0 = Sunday .. 6 = Saturday, matching `location_hours.day_of_week`. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** "HH:mm" or "HH:mm:ss" as stored in Postgres `time` columns. */
export type TimeString = string;

/** Current instant, viewed as Hawaii wall time. */
export function cafeNow(): TZDate {
  return TZDate.tz(CAFE_TIMEZONE);
}

/** Reinterprets an instant in Hawaii wall time without shifting the instant. */
export function toCafeTime(date: Date): TZDate {
  return new TZDate(date, CAFE_TIMEZONE);
}

/** Which day's opening hours apply to this instant. */
export function cafeDayOfWeek(date: Date = new Date()): DayOfWeek {
  return toCafeTime(date).getDay() as DayOfWeek;
}

/** "2026-09-23" for the Hawaii calendar day containing this instant. */
export function cafeDateKey(date: Date = new Date()): string {
  const cafe = toCafeTime(date);
  const month = String(cafe.getMonth() + 1).padStart(2, "0");
  const day = String(cafe.getDate()).padStart(2, "0");
  return `${cafe.getFullYear()}-${month}-${day}`;
}

/** Midnight in Hawaii at the start of the day containing `date`. */
export function startOfCafeDay(date: Date = new Date()): Date {
  const cafe = toCafeTime(date);
  return new TZDate(cafe.getFullYear(), cafe.getMonth(), cafe.getDate(), 0, 0, 0, 0, CAFE_TIMEZONE);
}

/**
 * Combines a Hawaii calendar day with a "HH:mm[:ss]" wall time into a real
 * instant. This is how `location_hours` rows become comparable timestamps.
 */
export function cafeDateAtTime(day: Date, time: TimeString): Date {
  const [hours = 0, minutes = 0, seconds = 0] = time.split(":").map(Number);
  const cafe = toCafeTime(day);
  return new TZDate(
    cafe.getFullYear(),
    cafe.getMonth(),
    cafe.getDate(),
    hours,
    minutes,
    seconds,
    0,
    CAFE_TIMEZONE,
  );
}

/**
 * A Honolulu calendar date ("2026-10-18") and wall time ("10:30") as an
 * instant, for forms that ask for a date and a time in Hawaii. Null when the
 * date does not exist ("2026-02-30") or either part is malformed.
 */
export function cafeInstant(dateKey: string, time: string): Date | null {
  const date = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!date || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) return null;
  // Noon UTC on that date is the same date in Honolulu (UTC-10).
  const noon = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), 12));
  const at = new Date(cafeDateAtTime(noon, time.length === 5 ? `${time}:00` : time).getTime());
  return cafeDateKey(at) === dateKey ? at : null;
}

/** "10:30" for an instant, in Honolulu (for a time input). */
export function cafeTimeKey(date: Date): string {
  const cafe = toCafeTime(date);
  return `${String(cafe.getHours()).padStart(2, "0")}:${String(cafe.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Formatting. Intl is used directly so the timezone is explicit at every call
// and cannot be forgotten.
// ---------------------------------------------------------------------------

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: CAFE_TIMEZONE, ...options });
}

/** "2:45 PM" */
export const formatCafeTimeOfDay = (date: Date): string =>
  formatter({ hour: "numeric", minute: "2-digit" }).format(date);

/** "Wed, Sep 23" */
export const formatCafeDate = (date: Date): string =>
  formatter({ weekday: "short", month: "short", day: "numeric" }).format(date);

/** "Wednesday, September 23, 2026" */
export const formatCafeDateLong = (date: Date): string =>
  formatter({ weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);

/** "Sep 23" */
export const formatCafeMonthDay = (date: Date): string =>
  formatter({ month: "short", day: "numeric" }).format(date);

/** "Wed" */
export const formatCafeWeekdayShort = (date: Date): string =>
  formatter({ weekday: "short" }).format(date);

/** "Sep 23, 2026" -- order history rows. */
export const formatCafeDateWithYear = (date: Date): string =>
  formatter({ month: "short", day: "numeric", year: "numeric" }).format(date);

/** "Sep 23, 2:45 PM" -- the compact stamp used on order cards. */
export const formatCafeDateTime = (date: Date): string =>
  formatter({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);

/** "Sunday" .. "Saturday" for an hours table. */
export function dayOfWeekLabel(day: DayOfWeek): string {
  // 2024-01-07 was a Sunday, so adding `day` lands on the right weekday.
  const reference = new Date(Date.UTC(2024, 0, 7 + day, 12));
  return new Intl.DateTimeFormat(LOCALE, { weekday: "long", timeZone: "UTC" }).format(reference);
}

/** "5:30 AM" from a stored "05:30:00". */
export function formatTimeString(time: TimeString): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const reference = new Date(Date.UTC(2024, 0, 1, hours, minutes));
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(reference);
}

/** "in 12 min" / "5 min ago" -- used on the order tracker. */
export function formatRelativeMinutes(target: Date, from: Date = new Date()): string {
  const minutes = differenceInMinutes(target, from);
  if (minutes === 0) return "now";
  if (minutes > 0) return `in ${minutes} min`;
  return `${Math.abs(minutes)} min ago`;
}

// ---------------------------------------------------------------------------
// Slot generation. Used by checkout for scheduled pickups.
// ---------------------------------------------------------------------------

/**
 * Rounds an instant up to the next slot boundary (default 15 minutes), so the
 * earliest offered slot is always in the future.
 */
export function ceilToSlot(date: Date, slotMinutes: number): Date {
  const ms = slotMinutes * 60_000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

/**
 * Every slot start between `opensAt` and `closesAt`, skipping any that fall
 * before `earliest` (now + prep time).
 *
 * The last slot is the final one that still leaves time to make the drink
 * before close.
 */
export function generateSlots({
  opensAt,
  closesAt,
  earliest,
  slotMinutes,
  prepMinutes,
}: {
  opensAt: Date;
  closesAt: Date;
  earliest: Date;
  slotMinutes: number;
  prepMinutes: number;
}): Date[] {
  const slots: Date[] = [];
  const lastUsable = addMinutes(closesAt, -prepMinutes);

  let cursor = ceilToSlot(isBefore(opensAt, earliest) ? earliest : opensAt, slotMinutes);

  while (!isAfter(cursor, lastUsable)) {
    slots.push(cursor);
    cursor = addMinutes(cursor, slotMinutes);
  }

  return slots;
}

export { addDays, addMinutes, differenceInMinutes };

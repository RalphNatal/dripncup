/**
 * Month and week grids for the admin catering calendar, in Honolulu dates.
 * Pure: a date key ("2026-10-18") in, date keys out; weeks run Sunday to
 * Saturday, like the cafe's hours table.
 */
import { cafeInstant } from "@/lib/time";

/** "2026-10-18" -> a UTC-noon Date (safe for date arithmetic in any zone). */
function noon(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function keyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysToKey(key: string, days: number): string {
  const date = noon(key);
  date.setUTCDate(date.getUTCDate() + days);
  return keyOf(date);
}

export function weekStartKey(key: string): string {
  return addDaysToKey(key, -noon(key).getUTCDay());
}

/** The seven days of the week containing `key`. */
export function weekKeys(key: string): string[] {
  const start = weekStartKey(key);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i));
}

/** Whole weeks covering the month containing `key` (4 to 6 rows of 7). */
export function monthGrid(key: string): string[][] {
  const [y, m] = key.split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = keyOf(new Date(Date.UTC(y, m, 0, 12)));
  const weeks: string[][] = [];
  for (let start = weekStartKey(first); start <= last; start = addDaysToKey(start, 7)) weeks.push(weekKeys(start));
  return weeks;
}

export function monthOf(key: string): string {
  return key.slice(0, 7);
}

/** The first day of the month before / after the one containing `key`. */
export function shiftMonth(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  return keyOf(new Date(Date.UTC(y, m - 1 + months, 1, 12)));
}

/** [start, end) instants for a run of Honolulu dates, for the database query. */
export function rangeOf(keys: string[]): { from: Date; to: Date } {
  return { from: cafeInstant(keys[0], "00:00")!, to: cafeInstant(addDaysToKey(keys[keys.length - 1], 1), "00:00")! };
}

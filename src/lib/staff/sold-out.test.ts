import { describe, expect, it } from "vitest";

import type { Closure, WeeklyHours } from "@/lib/locations/status";

import { endOfDayResetAt, soldOutUntil } from "./sold-out";

/** Explicit -10:00 offsets. 2026-10-02 is a Friday, 2026-10-03 a Saturday. */
const hst = (isoLocal: string) => new Date(`${isoLocal}-10:00`);

// The seed: weekdays 6:30-4, Fri 6:30-6, Sat 7-6, Sun 7-3.
const HOURS: WeeklyHours[] = [
  { dayOfWeek: 0, opensAt: "07:00:00", closesAt: "15:00:00" },
  { dayOfWeek: 1, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 2, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 3, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 4, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 5, opensAt: "06:30:00", closesAt: "18:00:00" },
  { dayOfWeek: 6, opensAt: "07:00:00", closesAt: "18:00:00" },
];

const cafe = { id: "cafe", type: "cafe" as const };

const reset = (now: Date, hours = HOURS, closures: Closure[] = []) =>
  endOfDayResetAt({ location: cafe, hours, closures, now });

describe("endOfDayResetAt", () => {
  it("resets at the next day's opening when marked during the day", () => {
    expect(reset(hst("2026-10-02T14:00:00"))).toEqual(hst("2026-10-03T07:00:00"));
  });

  it("resets at the next day's opening when marked after closing", () => {
    expect(reset(hst("2026-10-02T21:30:00"))).toEqual(hst("2026-10-03T07:00:00"));
  });

  it("marked before today's opening, it still lasts the whole of today", () => {
    expect(reset(hst("2026-10-02T06:00:00"))).toEqual(hst("2026-10-03T07:00:00"));
  });

  it("works in Honolulu time, whatever the UTC date", () => {
    // 11:30 PM Saturday in Honolulu is already Sunday in UTC.
    expect(reset(hst("2026-10-03T23:30:00"))).toEqual(hst("2026-10-04T07:00:00"));
  });

  it("is not reset by the second half of a split day", () => {
    const split: WeeklyHours[] = [
      { dayOfWeek: 5, opensAt: "06:30:00", closesAt: "11:00:00" },
      { dayOfWeek: 5, opensAt: "17:00:00", closesAt: "21:00:00" },
      { dayOfWeek: 6, opensAt: "08:00:00", closesAt: "12:00:00" },
    ];
    expect(reset(hst("2026-10-02T09:00:00"), split)).toEqual(hst("2026-10-03T08:00:00"));
  });

  it("skips a closure and uses holiday hours", () => {
    const closures: Closure[] = [
      { locationId: "cafe", date: "2026-10-03", isClosed: true, opensAt: null, closesAt: null, reason: "Staff day" },
      { locationId: null, date: "2026-10-04", isClosed: false, opensAt: "09:00:00", closesAt: "13:00:00", reason: "Holiday hours" },
    ];
    expect(reset(hst("2026-10-02T14:00:00"), HOURS, closures)).toEqual(hst("2026-10-04T09:00:00"));
  });

  it("skips days the cafe does not open", () => {
    const weekdaysOnly = HOURS.filter((h) => h.dayOfWeek >= 1 && h.dayOfWeek <= 5);
    expect(reset(hst("2026-10-02T14:00:00"), weekdaysOnly)).toEqual(hst("2026-10-05T06:30:00"));
  });

  it("falls back to the next Honolulu midnight when there is no opening ahead", () => {
    expect(reset(hst("2026-10-02T14:00:00"), [])).toEqual(hst("2026-10-03T00:00:00"));
  });

  it("resets a pop-up's flags at the next Honolulu midnight", () => {
    const event = { id: "pop", type: "event" as const };
    expect(endOfDayResetAt({ location: event, hours: [], closures: [], now: hst("2026-10-03T13:00:00") })).toEqual(
      hst("2026-10-04T00:00:00"),
    );
  });
});

describe("soldOutUntil", () => {
  it("is the reset time for end of day, and null until turned back on", () => {
    const input = { location: cafe, hours: HOURS, closures: [], now: hst("2026-10-02T14:00:00") };
    expect(soldOutUntil("end_of_day", input)).toBe(hst("2026-10-03T07:00:00").toISOString());
    expect(soldOutUntil("until_back_on", input)).toBeNull();
  });
});

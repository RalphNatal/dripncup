import { describe, expect, it } from "vitest";

import {
  getLocationStatus,
  orderingUnavailableReason,
  statusDetail,
  statusLabel,
  todaysHoursText,
  type Closure,
  type StatusInput,
  type WeeklyHours,
} from "./status";

/**
 * Every instant is written with an explicit -10:00 offset, so these tests mean
 * the same thing on a laptop in Manila, a CI box in UTC, or a phone in Hilo.
 * 2026-09-24 is a Thursday.
 */
const hst = (isoLocal: string) => new Date(`${isoLocal}-10:00`);

// Mirrors the seed: weekdays 6:30-4, Fri 6:30-6, weekends 7-3 / 7-6.
const HOURS: WeeklyHours[] = [
  { dayOfWeek: 0, opensAt: "07:00:00", closesAt: "15:00:00" },
  { dayOfWeek: 1, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 2, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 3, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 4, opensAt: "06:30:00", closesAt: "16:00:00" },
  { dayOfWeek: 5, opensAt: "06:30:00", closesAt: "18:00:00" },
  { dayOfWeek: 6, opensAt: "07:00:00", closesAt: "18:00:00" },
];

const cafe = { id: "cafe", type: "cafe" as const, acceptingOrders: true, startsAt: null, endsAt: null };

function input(now: Date, overrides: Partial<StatusInput> = {}): StatusInput {
  return { location: cafe, hours: HOURS, closures: [], now, ...overrides };
}

const closure = (overrides: Partial<Closure>): Closure => ({
  locationId: "cafe",
  date: "2026-09-24",
  isClosed: true,
  opensAt: null,
  closesAt: null,
  reason: null,
  ...overrides,
});

const describeStatus = (i: StatusInput) => statusLabel(getLocationStatus(i), i.now);

describe("regular hours", () => {
  it("is open during the day", () => {
    const status = getLocationStatus(input(hst("2026-09-24T10:00:00")));
    expect(status).toEqual({ kind: "open", canOrder: true, closesAt: hst("2026-09-24T16:00:00") });
    expect(statusLabel(status, hst("2026-09-24T10:00:00"))).toBe("Open");
    expect(statusDetail(status)).toBe("Until 4:00 PM");
  });

  it("is still open one second before closing", () => {
    expect(getLocationStatus(input(hst("2026-09-24T15:59:59"))).kind).toBe("open");
  });

  it("is closed at the closing time itself, and opens tomorrow morning", () => {
    const now = hst("2026-09-24T16:00:00");
    const status = getLocationStatus(input(now));
    expect(status).toEqual({ kind: "closed", canOrder: false, opensAt: hst("2026-09-25T06:30:00") });
    expect(statusLabel(status, now)).toBe("Closed · Opens Fri 6:30 AM");
  });

  it("is closed just after closing", () => {
    expect(getLocationStatus(input(hst("2026-09-24T16:00:01"))).kind).toBe("closed");
  });

  it("is open from the opening minute", () => {
    expect(getLocationStatus(input(hst("2026-09-24T06:29:59"))).kind).toBe("closed");
    expect(getLocationStatus(input(hst("2026-09-24T06:30:00"))).kind).toBe("open");
  });

  it("says the time alone when it opens later today", () => {
    expect(describeStatus(input(hst("2026-09-24T05:00:00")))).toBe("Closed · Opens 6:30 AM");
  });

  it("uses Honolulu's day, not UTC's: 11 PM Thursday HST is Friday in UTC", () => {
    // 2026-09-25T09:00Z. A UTC-based check would think it is Friday morning.
    expect(describeStatus(input(hst("2026-09-24T23:00:00")))).toBe("Closed · Opens Fri 6:30 AM");
  });

  it("handles split hours", () => {
    const split: WeeklyHours[] = [
      { dayOfWeek: 4, opensAt: "06:30:00", closesAt: "11:00:00" },
      { dayOfWeek: 4, opensAt: "13:00:00", closesAt: "16:00:00" },
    ];
    expect(describeStatus(input(hst("2026-09-24T12:00:00"), { hours: split }))).toBe("Closed · Opens 1:00 PM");
    expect(getLocationStatus(input(hst("2026-09-24T13:30:00"), { hours: split })).kind).toBe("open");
  });

  it("says just Closed when there are no hours at all", () => {
    expect(describeStatus(input(hst("2026-09-24T10:00:00"), { hours: [] }))).toBe("Closed");
  });
});

describe("closure days", () => {
  it("is closed all day on a closure, and skips to the next open day", () => {
    const now = hst("2026-09-24T10:00:00");
    const status = getLocationStatus(input(now, { closures: [closure({ reason: "Staff retreat" })] }));
    expect(status).toEqual({ kind: "closed", canOrder: false, opensAt: hst("2026-09-25T06:30:00") });
  });

  it("skips several closed days when looking for the next opening", () => {
    const closures = ["2026-09-24", "2026-09-25", "2026-09-26"].map((date) => closure({ date }));
    expect(describeStatus(input(hst("2026-09-24T10:00:00"), { closures }))).toBe("Closed · Opens Sun 7:00 AM");
  });

  it("applies an all-locations closure", () => {
    const status = getLocationStatus(input(hst("2026-09-24T10:00:00"), { closures: [closure({ locationId: null })] }));
    expect(status.kind).toBe("closed");
  });

  it("ignores another location's closure", () => {
    const status = getLocationStatus(input(hst("2026-09-24T10:00:00"), { closures: [closure({ locationId: "elsewhere" })] }));
    expect(status.kind).toBe("open");
  });

  it("reports the closure in today's hours", () => {
    const closures = [closure({ reason: "Closed for Aloha Friday" })];
    expect(todaysHoursText(input(hst("2026-09-24T10:00:00"), { closures }))).toEqual({
      hours: "Closed today",
      note: "Closed for Aloha Friday",
    });
  });
});

describe("holiday hours", () => {
  const holiday = closure({ isClosed: false, opensAt: "08:00:00", closesAt: "12:00:00", reason: "Holiday hours" });

  it("replaces the day's regular hours", () => {
    expect(describeStatus(input(hst("2026-09-24T07:00:00"), { closures: [holiday] }))).toBe("Closed · Opens 8:00 AM");
    expect(getLocationStatus(input(hst("2026-09-24T11:59:59"), { closures: [holiday] }))).toEqual({
      kind: "open",
      canOrder: true,
      closesAt: hst("2026-09-24T12:00:00"),
    });
    // 2 PM would be open on a normal Thursday.
    expect(describeStatus(input(hst("2026-09-24T14:00:00"), { closures: [holiday] }))).toBe(
      "Closed · Opens Fri 6:30 AM",
    );
  });

  it("lets a location's own override win over an all-locations one", () => {
    const closures = [closure({ locationId: null }), holiday];
    expect(getLocationStatus(input(hst("2026-09-24T10:00:00"), { closures })).kind).toBe("open");
  });

  it("shows the holiday hours as today's hours", () => {
    expect(todaysHoursText(input(hst("2026-09-24T07:00:00"), { closures: [holiday] }))).toEqual({
      hours: "8:00 AM – 12:00 PM",
      note: "Holiday hours",
    });
  });
});

describe("pause", () => {
  const paused = { ...cafe, acceptingOrders: false };

  it("is Paused during open hours when staff pause online orders", () => {
    const now = hst("2026-09-24T10:00:00");
    const status = getLocationStatus(input(now, { location: paused }));
    expect(status).toEqual({ kind: "paused", canOrder: false, closesAt: hst("2026-09-24T16:00:00") });
    expect(statusLabel(status, now)).toBe("Paused");
    expect(orderingUnavailableReason(status, "Kapiolani", now)).toMatch(/paused online orders/);
  });

  it("reads Closed, not Paused, outside open hours", () => {
    expect(describeStatus(input(hst("2026-09-24T20:00:00"), { location: paused }))).toBe("Closed · Opens Fri 6:30 AM");
  });

  it("pauses everywhere when online ordering is switched off globally", () => {
    const status = getLocationStatus(input(hst("2026-09-24T10:00:00"), { onlineOrderingEnabled: false }));
    expect(status.kind).toBe("paused");
  });
});

describe("events", () => {
  const event = {
    id: "popup",
    type: "event" as const,
    acceptingOrders: true,
    startsAt: hst("2026-10-08T10:00:00").toISOString(),
    endsAt: hst("2026-10-08T15:00:00").toISOString(),
  };

  it("is an upcoming event before its window, and cannot take orders", () => {
    const now = hst("2026-09-24T10:00:00");
    const status = getLocationStatus(input(now, { location: event, hours: [] }));
    expect(status).toMatchObject({ kind: "event", phase: "upcoming", canOrder: false });
    expect(statusLabel(status, now)).toBe("Event · Oct 8, 10:00 AM – 3:00 PM");
    expect(orderingUnavailableReason(status, "The pop-up", now)).toBe(
      "Pre-orders for The pop-up open when the event starts: Oct 8, 10:00 AM – 3:00 PM.",
    );
  });

  it("is open inside its window, until the event ends", () => {
    expect(getLocationStatus(input(hst("2026-10-08T10:00:00"), { location: event, hours: [] }))).toEqual({
      kind: "open",
      canOrder: true,
      closesAt: hst("2026-10-08T15:00:00"),
    });
  });

  it("has ended after its window", () => {
    const status = getLocationStatus(input(hst("2026-10-08T15:00:00"), { location: event, hours: [] }));
    expect(status).toMatchObject({ kind: "event", phase: "ended", canOrder: false });
    expect(statusLabel(status, hst("2026-10-08T15:00:00"))).toBe("Event ended");
  });

  it("can be paused during its window", () => {
    const status = getLocationStatus(input(hst("2026-10-08T12:00:00"), { location: { ...event, acceptingOrders: false } }));
    expect(status.kind).toBe("paused");
  });

  it("labels a multi-day event by its dates", () => {
    const long = { ...event, endsAt: hst("2026-10-10T15:00:00").toISOString() };
    expect(describeStatus(input(hst("2026-09-24T10:00:00"), { location: long }))).toBe("Event · Oct 8 – Oct 10");
  });

  it("shows the event window as today's hours", () => {
    expect(todaysHoursText(input(hst("2026-09-24T10:00:00"), { location: event }))).toEqual({
      hours: "Oct 8, 10:00 AM – 3:00 PM",
      note: null,
    });
  });
});

describe("opening far ahead", () => {
  it("names the date rather than an ambiguous weekday a week or more out", () => {
    // Closed Sep 24 through Oct 1; the next opening is Friday Oct 2.
    const closures = Array.from({ length: 8 }, (_, i) =>
      closure({ date: new Date(Date.UTC(2026, 8, 24 + i)).toISOString().slice(0, 10) }),
    );
    expect(describeStatus(input(hst("2026-09-24T10:00:00"), { closures }))).toBe("Closed · Opens Oct 2, 6:30 AM");
  });
});

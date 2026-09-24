import { describe, expect, it } from "vitest";

import type { Closure, WeeklyHours } from "@/lib/locations/status";

import {
  estimateAsapReadyAt,
  getPickupOptions,
  isPickupStillServiceable,
  resolvePickupChoice,
  type PickupContext,
} from "./pickup";

/** Honolulu wall time with an explicit offset: machine timezone never matters. 2026-09-24 is a Thursday. */
const hst = (local: string) => new Date(`${local}-10:00`);
const iso = (local: string) => hst(local).toISOString();

const HOURS: WeeklyHours[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  dayOfWeek: day,
  opensAt: "06:30:00",
  closesAt: "16:00:00",
}));

function ctx(now: Date, overrides: Partial<PickupContext> = {}): PickupContext {
  return {
    location: {
      id: "cafe",
      name: "Kapiolani",
      type: "cafe",
      acceptingOrders: true,
      startsAt: null,
      endsAt: null,
      prepTimeMinutes: 8,
    },
    hours: HOURS,
    closures: [],
    onlineOrderingEnabled: true,
    now,
    settings: { slotMinutes: 15, lastSlotBufferMinutes: 15, maxOrdersPerSlot: 8, queueMinutesPerOrder: 2 },
    activeQueueCount: 0,
    slotBookings: {},
    ...overrides,
  };
}

const slotTimes = (c: PickupContext) => getPickupOptions(c).slots.map((s) => s.startsAt);

describe("ASAP", () => {
  it("is prep time plus a few minutes per queued order, rounded up to 5 minutes", () => {
    // 9:31 + 8 + 3 x 2 = 9:45
    expect(estimateAsapReadyAt(hst("2026-09-24T09:31:00"), 8, 3, 2)).toEqual(hst("2026-09-24T09:45:00"));
    // 9:31 + 8 = 9:39 -> 9:40
    expect(estimateAsapReadyAt(hst("2026-09-24T09:31:00"), 8, 0, 2)).toEqual(hst("2026-09-24T09:40:00"));
  });

  it("is offered while open", () => {
    const options = getPickupOptions(ctx(hst("2026-09-24T09:31:00"), { activeQueueCount: 3 }));
    expect(options.asap).toEqual({ available: true, readyAt: iso("2026-09-24T09:45:00"), unavailableReason: null });
  });

  it("is not offered when it would be ready after closing", () => {
    const options = getPickupOptions(ctx(hst("2026-09-24T15:55:00")));
    expect(options.asap.available).toBe(false);
    expect(options.asap.unavailableReason).toMatch(/Too close to closing/);
  });

  it("is not offered while closed", () => {
    expect(getPickupOptions(ctx(hst("2026-09-24T06:00:00"))).asap.available).toBe(false);
  });
});

describe("scheduled slots", () => {
  it("start at least the prep time from now, on 15-minute marks", () => {
    // 9:31 + 8 = 9:39 -> first slot 9:45
    expect(slotTimes(ctx(hst("2026-09-24T09:31:00")))[0]).toBe(iso("2026-09-24T09:45:00"));
  });

  it("end with the last slot a buffer before closing", () => {
    const slots = slotTimes(ctx(hst("2026-09-24T14:00:00")));
    // Closes 4:00 PM, 15-minute buffer: the last slot is 3:45 PM.
    expect(slots.at(-1)).toBe(iso("2026-09-24T15:45:00"));
    expect(slots).not.toContain(iso("2026-09-24T16:00:00"));
  });

  it("honour a longer buffer", () => {
    const c = ctx(hst("2026-09-24T14:00:00"));
    c.settings = { ...c.settings, lastSlotBufferMinutes: 30 };
    expect(slotTimes(c).at(-1)).toBe(iso("2026-09-24T15:30:00"));
  });

  it("run out near closing time, leaving only ASAP", () => {
    // 3:40 + 8 min prep is past the 3:45 last slot, but ASAP (3:50) is before close.
    const options = getPickupOptions(ctx(hst("2026-09-24T15:40:00")));
    expect(options.slots).toEqual([]);
    expect(options.asap.available).toBe(true);
    expect(options.canCheckout).toBe(true);
  });

  it("block checkout when neither ASAP nor a slot is left", () => {
    const options = getPickupOptions(ctx(hst("2026-09-24T15:55:00")));
    expect(options.canCheckout).toBe(false);
    expect(options.blockedReason).toMatch(/No pickup times are left/);
  });

  it("are today's only while open", () => {
    const slots = slotTimes(ctx(hst("2026-09-24T09:31:00")));
    expect(slots.every((s) => s.startsWith("2026-09-24") || s.startsWith("2026-09-25T0"))).toBe(true);
    expect(getPickupOptions(ctx(hst("2026-09-24T09:31:00"))).slotDate).toBe("2026-09-24");
  });

  it("start at opening time just before the cafe opens", () => {
    const options = getPickupOptions(ctx(hst("2026-09-24T06:29:00")));
    expect(options.slotDate).toBe("2026-09-24");
    expect(options.slots[0].startsAt).toBe(iso("2026-09-24T06:45:00")); // 6:29 + 8 = 6:37 -> 6:45
  });

  it("start from now plus prep just after opening", () => {
    const options = getPickupOptions(ctx(hst("2026-09-24T06:31:00")));
    expect(options.slots[0].startsAt).toBe(iso("2026-09-24T06:45:00"));
    expect(options.asap.available).toBe(true);
  });

  it("are the next open day's when closed for the night", () => {
    const options = getPickupOptions(ctx(hst("2026-09-24T20:00:00")));
    expect(options.slotDate).toBe("2026-09-25");
    expect(options.slots[0].startsAt).toBe(iso("2026-09-25T06:30:00"));
    expect(options.asap.available).toBe(false);
    expect(options.canCheckout).toBe(true);
  });

  it("skip a closure day to the next open day", () => {
    const closures: Closure[] = [
      { locationId: "cafe", date: "2026-09-25", isClosed: true, opensAt: null, closesAt: null, reason: null },
    ];
    const options = getPickupOptions(ctx(hst("2026-09-24T20:00:00"), { closures }));
    expect(options.slotDate).toBe("2026-09-26");
  });

  it("follow holiday hours", () => {
    const closures: Closure[] = [
      { locationId: "cafe", date: "2026-09-24", isClosed: false, opensAt: "08:00:00", closesAt: "12:00:00", reason: null },
    ];
    const slots = slotTimes(ctx(hst("2026-09-24T07:00:00"), { closures }));
    expect(slots[0]).toBe(iso("2026-09-24T08:00:00"));
    expect(slots.at(-1)).toBe(iso("2026-09-24T11:45:00"));
  });

  it("mark a full slot unavailable and keep the rest", () => {
    const options = getPickupOptions(
      ctx(hst("2026-09-24T09:31:00"), { slotBookings: { [iso("2026-09-24T10:00:00")]: 8, [iso("2026-09-24T10:15:00")]: 7 } }),
    );
    const byTime = Object.fromEntries(options.slots.map((s) => [s.startsAt, s.available]));
    expect(byTime[iso("2026-09-24T10:00:00")]).toBe(false);
    expect(byTime[iso("2026-09-24T10:15:00")]).toBe(true);
  });

  it("have no limit when max orders per slot is 0", () => {
    const c = ctx(hst("2026-09-24T09:31:00"), { slotBookings: { [iso("2026-09-24T10:00:00")]: 500 } });
    c.settings = { ...c.settings, maxOrdersPerSlot: 0 };
    expect(getPickupOptions(c).slots.every((s) => s.available)).toBe(true);
  });
});

describe("pop-up events", () => {
  const event = {
    id: "popup",
    name: "The pop-up",
    type: "event" as const,
    acceptingOrders: true,
    startsAt: iso("2026-10-08T10:00:00"),
    endsAt: iso("2026-10-08T15:00:00"),
    prepTimeMinutes: 12,
  };

  it("offer slots only inside the event window", () => {
    const slots = slotTimes(ctx(hst("2026-10-08T11:00:00"), { location: event, hours: [] }));
    expect(slots[0]).toBe(iso("2026-10-08T11:15:00")); // 11:00 + 12 = 11:12 -> 11:15
    expect(slots.at(-1)).toBe(iso("2026-10-08T14:45:00"));
  });

  it("block checkout before the window opens", () => {
    const options = getPickupOptions(ctx(hst("2026-09-24T10:00:00"), { location: event, hours: [] }));
    expect(options.canCheckout).toBe(false);
    expect(options.blockedReason).toMatch(/open when the event starts/);
  });

  it("block checkout after the window closes", () => {
    const options = getPickupOptions(ctx(hst("2026-10-08T15:00:00"), { location: event, hours: [] }));
    expect(options.canCheckout).toBe(false);
  });
});

describe("paused", () => {
  it("offers nothing while staff have paused online orders", () => {
    const c = ctx(hst("2026-09-24T09:31:00"));
    c.location = { ...c.location, acceptingOrders: false };
    const options = getPickupOptions(c);
    expect(options).toMatchObject({ canCheckout: false, slots: [], asap: { available: false } });
    expect(options.blockedReason).toMatch(/paused online orders/);
  });

  it("offers nothing while online ordering is off everywhere", () => {
    expect(getPickupOptions(ctx(hst("2026-09-24T09:31:00"), { onlineOrderingEnabled: false })).canCheckout).toBe(false);
  });
});

describe("resolvePickupChoice", () => {
  const options = getPickupOptions(
    ctx(hst("2026-09-24T09:31:00"), { slotBookings: { [iso("2026-09-24T10:00:00")]: 8 } }),
  );

  it("accepts ASAP with its estimate", () => {
    expect(resolvePickupChoice({ type: "asap" }, options)).toEqual({
      ok: true,
      pickup: { pickupType: "asap", scheduledFor: null, estimatedReadyAt: hst("2026-09-24T09:40:00") },
    });
  });

  it("accepts an offered slot, however the time is written", () => {
    const result = resolvePickupChoice({ type: "scheduled", slot: "2026-09-24T20:15:00.000Z" }, options);
    expect(result).toEqual({
      ok: true,
      pickup: {
        pickupType: "scheduled",
        scheduledFor: hst("2026-09-24T10:15:00"),
        estimatedReadyAt: hst("2026-09-24T10:15:00"),
      },
    });
  });

  it("refuses a full slot, a past slot and nonsense", () => {
    expect(resolvePickupChoice({ type: "scheduled", slot: iso("2026-09-24T10:00:00") }, options)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/filled up/),
    });
    expect(resolvePickupChoice({ type: "scheduled", slot: iso("2026-09-24T09:30:00") }, options)).toMatchObject({
      ok: false,
    });
    expect(resolvePickupChoice({ type: "scheduled", slot: "tomorrow-ish" }, options)).toMatchObject({ ok: false });
  });
});

describe("isPickupStillServiceable (payment webhook re-check)", () => {
  const base = ctx(hst("2026-09-24T09:31:00"));

  it("passes an ASAP order while open", () => {
    expect(isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, base)).toEqual({ ok: true });
  });

  it("fails an ASAP order once closed", () => {
    const late = ctx(hst("2026-09-24T16:00:00"));
    expect(isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, late)).toMatchObject({
      ok: false,
      reason: "Kapiolani closed before your payment went through.",
    });
  });

  it("fails any order once paused", () => {
    const paused = { ...base, location: { ...base.location, acceptingOrders: false } };
    expect(isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, paused)).toMatchObject({
      ok: false,
      reason: "Kapiolani paused online orders before your payment went through.",
    });
  });

  it("passes a scheduled slot still inside opening hours, even when paid overnight", () => {
    const night = ctx(hst("2026-09-24T20:00:00"));
    expect(
      isPickupStillServiceable({ pickupType: "scheduled", scheduledFor: hst("2026-09-25T07:00:00") }, night),
    ).toEqual({ ok: true });
  });

  it("fails a scheduled slot a closure has since swallowed", () => {
    const closures: Closure[] = [
      { locationId: "cafe", date: "2026-09-25", isClosed: true, opensAt: null, closesAt: null, reason: null },
    ];
    const night = ctx(hst("2026-09-24T20:00:00"), { closures });
    expect(
      isPickupStillServiceable({ pickupType: "scheduled", scheduledFor: hst("2026-09-25T07:00:00") }, night),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/no longer open at your pickup time/) });
  });

  it("fails an event order once the event has ended", () => {
    const ended = ctx(hst("2026-10-08T15:01:00"), {
      location: {
        id: "popup",
        name: "The pop-up",
        type: "event",
        acceptingOrders: true,
        startsAt: iso("2026-10-08T10:00:00"),
        endsAt: iso("2026-10-08T15:00:00"),
        prepTimeMinutes: 12,
      },
      hours: [],
    });
    expect(isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, ended)).toMatchObject({
      ok: false,
      reason: "The pop-up ended before your payment went through.",
    });
  });
});

/**
 * Ordering with local test mode (TEST_STORE_ALWAYS_OPEN) in force.
 *
 * The flag reaches the rules through one door: `openingHours(..., true)`
 * swaps the stored hours and closures for "open 24 hours, no closures".
 * These tests feed its output to the same pure functions the storefront,
 * checkout, webhook and staff dashboard use, at instants when the real cafe
 * is shut, and check that only the hours changed: pause, pop-up windows and
 * sold-out flags still block.
 */
import { describe, expect, it } from "vitest";

import { getPickupOptions, isPickupStillServiceable, OVERNIGHT_SLOT_HOURS, type PickupContext } from "@/lib/checkout/pickup";
import { defaultSelection, validateSelection, type PricingProduct } from "@/lib/pricing";
import { endOfDayResetAt } from "@/lib/staff/sold-out";

import { openingHours } from "./opening-hours";
import { getLocationStatus, statusDetail, statusLabel, todaysHoursText } from "./status";

/** Honolulu wall time with an explicit offset. 2026-09-25 is a Friday. */
const hst = (local: string) => new Date(`${local}-10:00`);
const iso = (local: string) => hst(local).toISOString();

// The seeded rows (7 AM - 6 PM daily) plus a closure today, as the database holds them.
const HOUR_ROWS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day_of_week: day, opens_at: "07:00:00", closes_at: "18:00:00" }));
const CLOSURE_ROWS = [
  {
    location_id: null,
    closure_date: "2026-09-25",
    is_closed: true,
    opens_at: null,
    closes_at: null,
    reason: "Staff retreat",
  },
];

const real = openingHours(HOUR_ROWS, CLOSURE_ROWS, false);
const testMode = openingHours(HOUR_ROWS, CLOSURE_ROWS, true);

const cafe = { id: "cafe", type: "cafe" as const, acceptingOrders: true, startsAt: null, endsAt: null };

function ctx(now: Date, overrides: Partial<PickupContext> = {}): PickupContext {
  return {
    location: { ...cafe, name: "Kapiolani", prepTimeMinutes: 8 },
    ...testMode,
    onlineOrderingEnabled: true,
    now,
    settings: { slotMinutes: 15, lastSlotBufferMinutes: 15, maxOrdersPerSlot: 8, queueMinutesPerOrder: 2 },
    activeQueueCount: 0,
    slotBookings: {},
    ...overrides,
  };
}

describe("openingHours", () => {
  it("passes the stored hours and closures through when test mode is off", () => {
    expect(real.hours).toHaveLength(7);
    expect(real.hours[0]).toEqual({ dayOfWeek: 0, opensAt: "07:00:00", closesAt: "18:00:00" });
    expect(real.closures).toEqual([
      { locationId: null, date: "2026-09-25", isClosed: true, opensAt: null, closesAt: null, reason: "Staff retreat" },
    ]);
  });

  it("swaps them for midnight-to-midnight every day, no closures, in test mode", () => {
    expect(testMode.closures).toEqual([]);
    expect(testMode.hours).toHaveLength(7);
    expect(testMode.hours.every((h) => h.opensAt === "00:00:00" && h.closesAt === "24:00:00")).toBe(true);
  });
});

describe("test mode: the cafe is open at 2 AM Honolulu time, closure or not", () => {
  const twoAm = hst("2026-09-25T02:00:00");

  it("is closed for real (before opening, and on a closure day)", () => {
    expect(getLocationStatus({ location: cafe, ...real, now: twoAm }).kind).toBe("closed");
  });

  it("reads Open, open 24 hours, in the header and location list", () => {
    const status = getLocationStatus({ location: cafe, ...testMode, now: twoAm });
    expect(status.kind).toBe("open");
    expect(status.canOrder).toBe(true);
    expect(statusLabel(status, twoAm)).toBe("Open");
    expect(statusDetail(status, twoAm)).toBe("Open 24 hours");
    expect(todaysHoursText({ location: cafe, ...testMode, now: twoAm })).toEqual({ hours: "Open 24 hours", note: null });
  });

  it("offers ASAP and 15-minute slots for checkout and order creation", () => {
    const options = getPickupOptions(ctx(twoAm));
    expect(options.canCheckout).toBe(true);
    expect(options.asap).toEqual({ available: true, readyAt: iso("2026-09-25T02:10:00"), unavailableReason: null });
    expect(options.slots.slice(0, 3).map((s) => s.startsAt)).toEqual([
      iso("2026-09-25T02:15:00"),
      iso("2026-09-25T02:30:00"),
      iso("2026-09-25T02:45:00"),
    ]);
  });

  it("passes the webhook's after-payment re-check, so nothing is auto-refunded", () => {
    expect(isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, ctx(twoAm))).toEqual({ ok: true });
    expect(
      isPickupStillServiceable({ pickupType: "scheduled", scheduledFor: hst("2026-09-25T03:00:00") }, ctx(twoAm)),
    ).toEqual({ ok: true });
  });

  it("would still be refunded for real: the cafe is closed at that pickup time", () => {
    const check = isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, { ...ctx(twoAm), ...real });
    expect(check.ok).toBe(false);
  });
});

describe("test mode: past midnight", () => {
  it("keeps ASAP available just before midnight", () => {
    const options = getPickupOptions(ctx(hst("2026-09-25T23:55:00")));
    expect(options.asap).toEqual({ available: true, readyAt: iso("2026-09-26T00:05:00"), unavailableReason: null });
  });

  it("offers slots every 15 minutes through midnight, several hours ahead", () => {
    const now = hst("2026-09-25T23:00:00");
    const slots = getPickupOptions(ctx(now)).slots.map((s) => s.startsAt);
    expect(slots).toContain(iso("2026-09-25T23:45:00"));
    expect(slots).toContain(iso("2026-09-26T00:00:00"));
    expect(slots).toContain(iso("2026-09-26T00:15:00"));
    expect(slots).toContain(iso("2026-09-26T03:00:00"));
    // Every 15 minutes, no gaps or repeats.
    const gaps = slots.slice(1).map((s, i) => new Date(s).getTime() - new Date(slots[i]).getTime());
    expect(new Set(gaps)).toEqual(new Set([15 * 60_000]));
    // ...and stopping at the horizon rather than running for days.
    const last = new Date(slots.at(-1)!).getTime();
    expect(last).toBeLessThanOrEqual(now.getTime() + OVERNIGHT_SLOT_HOURS * 3_600_000);
  });

  it("accepts a paid order for a slot after midnight", () => {
    expect(
      isPickupStillServiceable(
        { pickupType: "scheduled", scheduledFor: hst("2026-09-26T00:30:00") },
        ctx(hst("2026-09-25T23:40:00")),
      ),
    ).toEqual({ ok: true });
  });

  it("resets an 'until end of day' sold-out flag at the next midnight", () => {
    expect(endOfDayResetAt({ location: cafe, ...testMode, now: hst("2026-09-25T02:00:00") })).toEqual(
      hst("2026-09-26T00:00:00"),
    );
  });
});

describe("test mode does not override pause, pop-up windows or sold out", () => {
  const twoAm = hst("2026-09-25T02:00:00");

  it("pause still blocks checkout", () => {
    const paused = { ...cafe, name: "Kapiolani", prepTimeMinutes: 8, acceptingOrders: false };
    const status = getLocationStatus({ location: paused, ...testMode, now: twoAm });
    expect(status.kind).toBe("paused");
    expect(status.canOrder).toBe(false);

    const options = getPickupOptions(ctx(twoAm, { location: paused }));
    expect(options.canCheckout).toBe(false);
    expect(options.blockedReason).toMatch(/paused online orders/);
    expect(isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, ctx(twoAm, { location: paused })).ok).toBe(
      false,
    );
  });

  it("the global online-ordering switch still blocks checkout", () => {
    expect(getPickupOptions(ctx(twoAm, { onlineOrderingEnabled: false })).canCheckout).toBe(false);
  });

  it("an event outside its window still can't be ordered from", () => {
    const event = {
      id: "popup",
      type: "event" as const,
      name: "Kakaʻako Pop-Up",
      prepTimeMinutes: 12,
      acceptingOrders: true,
      startsAt: iso("2026-10-08T10:00:00"),
      endsAt: iso("2026-10-08T15:00:00"),
    };
    const status = getLocationStatus({ location: event, ...testMode, now: twoAm });
    expect(status).toMatchObject({ kind: "event", phase: "upcoming", canOrder: false });

    const options = getPickupOptions(ctx(twoAm, { location: event }));
    expect(options.canCheckout).toBe(false);
    expect(options.blockedReason).toMatch(/open when the event starts/);

    const after = hst("2026-10-08T16:00:00");
    expect(getLocationStatus({ location: event, ...testMode, now: after })).toMatchObject({ kind: "event", phase: "ended" });
    expect(
      isPickupStillServiceable({ pickupType: "asap", scheduledFor: null }, ctx(after, { location: event })).ok,
    ).toBe(false);
  });

  it("an event inside its window takes orders only until it ends", () => {
    const event = {
      id: "popup",
      type: "event" as const,
      name: "Kakaʻako Pop-Up",
      prepTimeMinutes: 12,
      acceptingOrders: true,
      startsAt: iso("2026-10-08T10:00:00"),
      endsAt: iso("2026-10-08T15:00:00"),
    };
    const options = getPickupOptions(ctx(hst("2026-10-08T14:00:00"), { location: event }));
    expect(options.canCheckout).toBe(true);
    expect(options.slots.at(-1)?.startsAt).toBe(iso("2026-10-08T14:45:00"));
  });

  it("a sold-out item still can't be added, though the cafe reads open", () => {
    expect(getLocationStatus({ location: cafe, ...testMode, now: twoAm }).canOrder).toBe(true);
    const soldOut: PricingProduct = { id: "cookie", name: "Cookie", basePriceCents: 375, soldOut: true, sizes: [] };
    const errors = validateSelection(soldOut, [], defaultSelection(soldOut, []));
    expect(errors.map((e) => e.code)).toEqual(["product_sold_out"]);
  });
});

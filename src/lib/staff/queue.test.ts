import { describe, expect, it } from "vitest";

import {
  assignColumn,
  buildQueue,
  dueAt,
  formatElapsed,
  formatMinutes,
  nextAction,
  summarise,
  spokenMinutes,
  targetReadyAt,
  ticketTimer,
  ticketUrgency,
  type StaffOrder,
} from "./queue";

/** Explicit -10:00 offsets: these mean the same thing on any machine. 2026-10-03 is a Saturday. */
const hst = (isoLocal: string) => new Date(`${isoLocal}-10:00`);
const iso = (isoLocal: string) => hst(isoLocal).toISOString();

const PREP = 8;

function order(overrides: Partial<StaffOrder> = {}): StaffOrder {
  return {
    id: overrides.orderNumber ?? "o1",
    orderNumber: "DC-261003-0001",
    status: "placed",
    cupName: "Kai",
    notes: null,
    pickupType: "asap",
    scheduledFor: null,
    estimatedReadyAt: iso("2026-10-03T09:10:00"),
    createdAt: iso("2026-10-03T08:59:00"),
    placedAt: iso("2026-10-03T09:00:00"),
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    cancelledAt: null,
    cancellationReason: null,
    items: [],
    ...overrides,
  };
}

describe("assignColumn", () => {
  it("puts a placed ASAP order in New", () => {
    expect(assignColumn(order(), hst("2026-10-03T09:00:05"), PREP)).toBe("new");
  });

  it("keeps a scheduled order in Upcoming until pickup minus prep time, then New", () => {
    const scheduled = order({ pickupType: "scheduled", scheduledFor: iso("2026-10-03T10:00:00") });
    expect(dueAt(scheduled, PREP)).toEqual(hst("2026-10-03T09:52:00"));
    expect(assignColumn(scheduled, hst("2026-10-03T09:00:00"), PREP)).toBe("upcoming");
    expect(assignColumn(scheduled, hst("2026-10-03T09:51:59"), PREP)).toBe("upcoming");
    expect(assignColumn(scheduled, hst("2026-10-03T09:52:00"), PREP)).toBe("new");
    expect(assignColumn(scheduled, hst("2026-10-03T10:30:00"), PREP)).toBe("new");
  });

  it("uses the location's own prep time", () => {
    const scheduled = order({ pickupType: "scheduled", scheduledFor: iso("2026-10-03T10:00:00") });
    expect(assignColumn(scheduled, hst("2026-10-03T09:50:00"), 12)).toBe("new");
    expect(assignColumn(scheduled, hst("2026-10-03T09:50:00"), 5)).toBe("upcoming");
  });

  it("groups accepted and preparing as In progress, and Ready on its own", () => {
    expect(assignColumn(order({ status: "accepted" }), hst("2026-10-03T09:01:00"), PREP)).toBe("in_progress");
    expect(assignColumn(order({ status: "preparing" }), hst("2026-10-03T09:01:00"), PREP)).toBe("in_progress");
    expect(assignColumn(order({ status: "ready" }), hst("2026-10-03T09:01:00"), PREP)).toBe("ready");
  });

  it("an accepted scheduled order is In progress even before it is due", () => {
    const early = order({ status: "accepted", pickupType: "scheduled", scheduledFor: iso("2026-10-03T12:00:00") });
    expect(assignColumn(early, hst("2026-10-03T09:00:00"), PREP)).toBe("in_progress");
  });

  it("leaves finished and unpaid orders off the queue", () => {
    for (const status of ["pending_payment", "picked_up", "cancelled", "refunded"] as const) {
      expect(assignColumn(order({ status }), hst("2026-10-03T09:01:00"), PREP)).toBeNull();
    }
  });
});

describe("buildQueue", () => {
  it("sorts each column by pickup time, ASAP orders by when they were placed", () => {
    const now = hst("2026-10-03T09:30:00");
    const queue = buildQueue(
      [
        order({ id: "late-asap", orderNumber: "DC-261003-0004", placedAt: iso("2026-10-03T09:20:00") }),
        order({
          id: "scheduled",
          orderNumber: "DC-261003-0001",
          pickupType: "scheduled",
          scheduledFor: iso("2026-10-03T09:30:00"),
          placedAt: iso("2026-10-03T07:00:00"),
        }),
        order({ id: "early-asap", orderNumber: "DC-261003-0003", placedAt: iso("2026-10-03T09:05:00") }),
        order({
          id: "later",
          orderNumber: "DC-261003-0002",
          pickupType: "scheduled",
          scheduledFor: iso("2026-10-03T11:00:00"),
          placedAt: iso("2026-10-03T07:30:00"),
        }),
        order({ id: "done", status: "picked_up" }),
      ],
      now,
      PREP,
    );
    expect(queue.new.map((o) => o.id)).toEqual(["early-asap", "late-asap", "scheduled"]);
    expect(queue.upcoming.map((o) => o.id)).toEqual(["later"]);
    expect(queue.in_progress).toEqual([]);
    expect(queue.ready).toEqual([]);
  });

  it("moves a scheduled order from Upcoming to New as the clock passes its due time", () => {
    const scheduled = order({ pickupType: "scheduled", scheduledFor: iso("2026-10-03T10:00:00") });
    expect(buildQueue([scheduled], hst("2026-10-03T09:51:00"), PREP).upcoming).toHaveLength(1);
    const after = buildQueue([scheduled], hst("2026-10-03T09:52:00"), PREP);
    expect(after.upcoming).toHaveLength(0);
    expect(after.new).toHaveLength(1);
  });
});

describe("ticketUrgency", () => {
  const thresholds = { warningMinutes: 5, lateMinutes: 10 };

  it("is ok until the warning threshold past the estimated ready time", () => {
    const o = order(); // estimated ready 9:10
    expect(ticketUrgency(o, hst("2026-10-03T09:10:00"), PREP, thresholds)).toBe("ok");
    expect(ticketUrgency(o, hst("2026-10-03T09:14:59"), PREP, thresholds)).toBe("ok");
  });

  it("turns to warning, then late", () => {
    const o = order({ status: "preparing" });
    expect(ticketUrgency(o, hst("2026-10-03T09:15:00"), PREP, thresholds)).toBe("warning");
    expect(ticketUrgency(o, hst("2026-10-03T09:19:59"), PREP, thresholds)).toBe("warning");
    expect(ticketUrgency(o, hst("2026-10-03T09:20:00"), PREP, thresholds)).toBe("late");
  });

  it("measures a scheduled order from its pickup time", () => {
    const o = order({ pickupType: "scheduled", scheduledFor: iso("2026-10-03T11:00:00"), estimatedReadyAt: null });
    expect(targetReadyAt(o, PREP)).toEqual(hst("2026-10-03T11:00:00"));
    expect(ticketUrgency(o, hst("2026-10-03T11:04:00"), PREP, thresholds)).toBe("ok");
    expect(ticketUrgency(o, hst("2026-10-03T11:05:00"), PREP, thresholds)).toBe("warning");
  });

  it("falls back to placed + prep time without an estimate", () => {
    const o = order({ estimatedReadyAt: null });
    expect(targetReadyAt(o, PREP)).toEqual(hst("2026-10-03T09:08:00"));
  });

  it("respects configured thresholds", () => {
    const o = order();
    expect(ticketUrgency(o, hst("2026-10-03T09:12:00"), PREP, { warningMinutes: 2, lateMinutes: 4 })).toBe("warning");
    expect(ticketUrgency(o, hst("2026-10-03T09:14:00"), PREP, { warningMinutes: 2, lateMinutes: 4 })).toBe("late");
  });

  it("never marks a ready or finished order late", () => {
    for (const status of ["ready", "picked_up", "cancelled"] as const) {
      expect(ticketUrgency(order({ status }), hst("2026-10-03T12:00:00"), PREP, thresholds)).toBe("ok");
    }
  });
});

describe("formatElapsed", () => {
  it("counts minutes and seconds, then hours", () => {
    const from = hst("2026-10-03T09:00:00");
    expect(formatElapsed(from, hst("2026-10-03T09:00:42"))).toBe("0:42");
    expect(formatElapsed(from, hst("2026-10-03T09:12:05"))).toBe("12:05");
    expect(formatElapsed(from, hst("2026-10-03T10:04:10"))).toBe("1:04:10");
  });

  it("never goes negative when a device clock runs behind", () => {
    expect(formatElapsed(hst("2026-10-03T09:00:10"), hst("2026-10-03T09:00:00"))).toBe("0:00");
  });
});

describe("formatMinutes and spokenMinutes", () => {
  const MIN = 60_000;
  it("reads at a glance, rounded down to the minute", () => {
    expect(formatMinutes(42_000)).toBe("<1m");
    expect(formatMinutes(4 * MIN + 59_000)).toBe("4m");
    expect(formatMinutes(59 * MIN)).toBe("59m");
    expect(formatMinutes(60 * MIN)).toBe("1h 00m");
    expect(formatMinutes(65 * MIN)).toBe("1h 05m");
    expect(formatMinutes(140 * MIN)).toBe("2h 20m");
    expect(formatMinutes(-5 * MIN)).toBe("<1m");
  });

  it("says the same in words", () => {
    expect(spokenMinutes(30_000)).toBe("less than a minute");
    expect(spokenMinutes(MIN)).toBe("1 minute");
    expect(spokenMinutes(12 * MIN)).toBe("12 minutes");
    expect(spokenMinutes(60 * MIN)).toBe("1 hour");
    expect(spokenMinutes(125 * MIN)).toBe("2 hours 5 minutes");
  });
});

describe("ticketTimer", () => {
  it("counts up from placed while on time", () => {
    expect(ticketTimer(order(), hst("2026-10-03T09:04:30"), PREP)).toEqual({
      kind: "waiting",
      text: "4m",
      label: "Waiting 4 minutes",
    });
  });

  it("says how late once past the time the customer was given (the ASAP estimate)", () => {
    // Estimated ready 9:10.
    expect(ticketTimer(order(), hst("2026-10-03T09:10:30"), PREP).kind).toBe("waiting");
    expect(ticketTimer(order(), hst("2026-10-03T09:22:00"), PREP)).toEqual({
      kind: "late",
      text: "12m late",
      label: "12 minutes late",
    });
    expect(ticketTimer(order({ status: "preparing" }), hst("2026-10-03T10:15:00"), PREP).text).toBe("1h 05m late");
  });

  it("counts a scheduled order from when it fell due, not from when it was placed", () => {
    const scheduled = order({
      pickupType: "scheduled",
      scheduledFor: iso("2026-10-03T14:00:00"),
      estimatedReadyAt: iso("2026-10-03T14:00:00"),
      placedAt: iso("2026-10-03T07:00:00"),
    });
    // Due at 13:52 (pickup minus 8 minutes' prep).
    expect(ticketTimer(scheduled, hst("2026-10-03T13:55:00"), PREP).text).toBe("3m");
    expect(ticketTimer(scheduled, hst("2026-10-03T14:07:00"), PREP).text).toBe("7m late");
  });

  it("counts a Ready order's wait for pickup", () => {
    const ready = order({ status: "ready", readyAt: iso("2026-10-03T09:20:00") });
    expect(ticketTimer(ready, hst("2026-10-03T09:28:10"), PREP)).toEqual({
      kind: "ready",
      text: "8m",
      label: "Ready for 8 minutes",
    });
  });
});

describe("summarise", () => {
  it("counts today's orders, the average time to ready and who is waiting", () => {
    const now = hst("2026-10-03T10:00:00");
    const orders = [
      order({ id: "a", status: "picked_up", placedAt: iso("2026-10-03T09:00:00"), readyAt: iso("2026-10-03T09:06:00") }),
      order({ id: "b", status: "ready", placedAt: iso("2026-10-03T09:10:00"), readyAt: iso("2026-10-03T09:20:00") }),
      // Scheduled last night for 9:30: timed from when it was due (9:22), not from last night.
      order({
        id: "c",
        status: "ready",
        pickupType: "scheduled",
        scheduledFor: iso("2026-10-03T09:30:00"),
        placedAt: iso("2026-10-02T20:00:00"),
        readyAt: iso("2026-10-03T09:30:00"),
      }),
      order({ id: "d", status: "preparing", placedAt: iso("2026-10-03T09:50:00") }),
      order({ id: "e", status: "placed", placedAt: iso("2026-10-03T09:58:00") }),
    ];
    const queue = buildQueue(orders, now, PREP);
    const summary = summarise(orders, queue, { todayStart: hst("2026-10-03T00:00:00"), prepMinutes: PREP });
    expect(summary.ordersToday).toBe(4);
    expect(summary.averageMinutesToReady).toBe(8); // (6 + 10) / 2; c was placed yesterday
    expect(summary.waiting).toBe(2);
  });

  it("has no average before the first order is ready", () => {
    const orders = [order()];
    const summary = summarise(orders, buildQueue(orders, hst("2026-10-03T09:01:00"), PREP), {
      todayStart: hst("2026-10-03T00:00:00"),
      prepMinutes: PREP,
    });
    expect(summary.averageMinutesToReady).toBeNull();
  });
});

describe("nextAction", () => {
  it("gives one forward move per status, with an undo window only for Ready and Picked up", () => {
    expect(nextAction("placed")).toEqual({ to: "accepted", label: "Accept" });
    expect(nextAction("accepted")).toEqual({ to: "preparing", label: "Start" });
    expect(nextAction("preparing")?.pendingLabel).toBe("Marking ready…");
    expect(nextAction("ready")?.pendingLabel).toBe("Marking picked up…");
    expect(nextAction("picked_up")).toBeNull();
    expect(nextAction("cancelled")).toBeNull();
  });
});

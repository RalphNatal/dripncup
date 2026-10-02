import { describe, expect, it } from "vitest";

import type { OrderDetail } from "./detail";
import { buildTimeline, plainCancellationReason, refundSentence } from "./timeline";

const T = {
  placed: "2026-10-03T19:00:00.000Z",
  accepted: "2026-10-03T19:01:00.000Z",
  preparing: "2026-10-03T19:03:00.000Z",
  ready: "2026-10-03T19:08:00.000Z",
  pickedUp: "2026-10-03T19:12:00.000Z",
  cancelled: "2026-10-03T19:05:00.000Z",
  refunded: "2026-10-03T19:05:30.000Z",
};

const NO_TIMES: OrderDetail["times"] = {
  placed: null,
  accepted: null,
  preparing: null,
  ready: null,
  pickedUp: null,
  cancelled: null,
  refunded: null,
};

const PAID: NonNullable<OrderDetail["payment"]> = {
  status: "succeeded",
  amountCents: 1227,
  failureMessage: null,
  refundedCents: 0,
  method: { brand: "visa", last4: "4242", wallet: null },
};

function order(status: OrderDetail["status"], times: Partial<OrderDetail["times"]>, extra: Partial<OrderDetail> = {}) {
  return { status, times: { ...NO_TIMES, ...times }, cancellationReason: null, payment: PAID, ...extra };
}

const states = (t: ReturnType<typeof buildTimeline>) => t.steps.map((s) => `${s.status}:${s.state}`);

describe("buildTimeline", () => {
  it("marks the current step and leaves later ones upcoming", () => {
    const timeline = buildTimeline(order("accepted", { placed: T.placed, accepted: T.accepted }));
    expect(states(timeline)).toEqual([
      "placed:done",
      "accepted:current",
      "preparing:upcoming",
      "ready:upcoming",
      "picked_up:upcoming",
    ]);
    expect(timeline.steps.map((s) => s.at)).toEqual([T.placed, T.accepted, null, null, null]);
    expect(timeline.outcome).toBeNull();
  });

  it("highlights Ready while the order waits on the shelf", () => {
    const timeline = buildTimeline(order("ready", { placed: T.placed, accepted: T.accepted, preparing: T.preparing, ready: T.ready }));
    expect(timeline.steps.find((s) => s.status === "ready")).toMatchObject({ state: "current", at: T.ready });
  });

  it("shows every step done once picked up", () => {
    const timeline = buildTimeline(order("picked_up", T));
    expect(timeline.steps.every((s) => s.state === "done")).toBe(true);
    expect(timeline.steps.at(-1)?.at).toBe(T.pickedUp);
  });

  it("keeps steps that happened and skips the rest when cancelled, with the reason and refund", () => {
    const timeline = buildTimeline(
      order("cancelled", { placed: T.placed, accepted: T.accepted, cancelled: T.cancelled }, { cancellationReason: "Out of oat milk" }),
    );
    expect(states(timeline)).toEqual([
      "placed:done",
      "accepted:done",
      "preparing:skipped",
      "ready:skipped",
      "picked_up:skipped",
    ]);
    expect(timeline.outcome).toEqual({
      kind: "cancelled",
      title: "Order cancelled",
      reason: "The cafe cancelled it: Out of oat milk.",
      refund: "Your refund of $12.27 is on its way to your Visa •••• 4242.",
      at: T.cancelled,
    });
  });

  it("ends a refunded order with the refund, at the time it was refunded", () => {
    const timeline = buildTimeline(
      order(
        "refunded",
        { placed: T.placed, cancelled: T.cancelled, refunded: T.refunded },
        { cancellationReason: "Customer asked us to", payment: { ...PAID, status: "refunded", refundedCents: 1227 } },
      ),
    );
    expect(timeline.outcome).toMatchObject({
      kind: "refunded",
      reason: "The cafe cancelled it: Customer asked us to.",
      refund: "We refunded $12.27 to your Visa •••• 4242. Refunds can take 5–10 business days to show.",
      at: T.refunded,
    });
  });

  it("does not repeat a cancel reason for a refund after pickup", () => {
    const timeline = buildTimeline(order("refunded", T, { payment: { ...PAID, status: "refunded", refundedCents: 1227 } }));
    expect(timeline.steps.every((s) => s.state === "done")).toBe(true);
    expect(timeline.outcome?.reason).toBeNull();
  });

  it("shows nothing as reached while payment is pending", () => {
    expect(states(buildTimeline(order("pending_payment", {}))).every((s) => s.endsWith(":upcoming"))).toBe(true);
  });
});

describe("plainCancellationReason", () => {
  it("rewords the reasons the system writes", () => {
    expect(plainCancellationReason("The payment was cancelled before it completed.")).toBe(
      "The payment didn't go through, so the order was cancelled.",
    );
    expect(plainCancellationReason("Customer closed their account")).toBe("The account was closed.");
  });

  it("keeps full sentences as they are and gives a barista's note a lead-in", () => {
    const webhook = "Drincup Cafe — Kapiolani paused online orders. You've been refunded in full.";
    expect(plainCancellationReason(webhook)).toBe(webhook);
    expect(plainCancellationReason("  Espresso machine down ")).toBe("The cafe cancelled it: Espresso machine down.");
  });

  it("is null without a reason", () => {
    expect(plainCancellationReason(null)).toBeNull();
    expect(plainCancellationReason("   ")).toBeNull();
  });
});

describe("refundSentence", () => {
  it("says nothing when no money was taken", () => {
    expect(refundSentence(null)).toBeNull();
    expect(refundSentence({ ...PAID, status: "requires_payment" })).toBeNull();
  });

  it("falls back to the original payment method when the card is unknown", () => {
    expect(refundSentence({ ...PAID, method: null, refundedCents: 500 })).toBe(
      "We refunded $5.00 to your original payment method. Refunds can take 5–10 business days to show.",
    );
  });
});

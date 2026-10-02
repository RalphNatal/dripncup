/**
 * The tracker's timeline: Placed → Accepted → Preparing → Ready → Picked Up,
 * each with the time it happened, plus how a cancelled or refunded order
 * ended, in plain language. Pure, so it is unit-tested on its own.
 */
import { formatCents } from "@/lib/money";
import { CUSTOMER_PROGRESS_STEPS, ORDER_STATUS_LABELS, type CustomerProgressStep } from "@/lib/order-status";

import { paymentMethodLabel, type OrderDetail } from "./detail";

/**
 * done      it happened
 * current   it happened, and it is where the order is now
 * upcoming  still to come
 * skipped   never happened (the order was cancelled first)
 */
export type StepState = "done" | "current" | "upcoming" | "skipped";

export interface TimelineStep {
  status: CustomerProgressStep;
  label: string;
  at: string | null;
  state: StepState;
}

export interface TimelineOutcome {
  kind: "cancelled" | "refunded";
  title: string;
  /** Why, in words a customer understands. */
  reason: string | null;
  /** What happened to their money, if any was taken. */
  refund: string | null;
  at: string | null;
}

export interface Timeline {
  steps: TimelineStep[];
  outcome: TimelineOutcome | null;
}

type TimelineInput = Pick<OrderDetail, "status" | "times" | "cancellationReason" | "payment">;

const TIME_OF: Record<CustomerProgressStep, keyof OrderDetail["times"]> = {
  placed: "placed",
  accepted: "accepted",
  preparing: "preparing",
  ready: "ready",
  picked_up: "pickedUp",
};

/** Reasons the system writes, said the way a customer would want to hear them. */
const SYSTEM_REASONS: Record<string, string> = {
  "The payment was cancelled before it completed.": "The payment didn't go through, so the order was cancelled.",
  "Customer closed their account": "The account was closed.",
  "Payment refunded": "The payment was refunded.",
  "Payment arrived after the order was cancelled": "The payment arrived after the order had already been cancelled.",
};

export function plainCancellationReason(reason: string | null): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  if (SYSTEM_REASONS[trimmed]) return SYSTEM_REASONS[trimmed];
  // Full sentences (the webhook's "… paused online orders. You've been
  // refunded in full.") read fine as they are; a barista's short note
  // ("Out of oat milk") gets a lead-in.
  return /[.!?]$/.test(trimmed) ? trimmed : `The cafe cancelled it: ${trimmed}.`;
}

/** What happened to the money on a cancelled or refunded order. */
export function refundSentence(payment: OrderDetail["payment"]): string | null {
  if (!payment || payment.amountCents <= 0) return null;
  if (!["succeeded", "partially_refunded", "refunded"].includes(payment.status)) return null;
  const method = paymentMethodLabel(payment.method);
  const to = method ? ` to your ${method}` : " to your original payment method";
  if (payment.refundedCents > 0) {
    return `We refunded ${formatCents(payment.refundedCents)}${to}. Refunds can take 5–10 business days to show.`;
  }
  return `Your refund of ${formatCents(payment.amountCents)} is on its way${to}.`;
}

export function buildTimeline(order: TimelineInput): Timeline {
  const ended = order.status === "cancelled" || order.status === "refunded";
  const currentIndex = (CUSTOMER_PROGRESS_STEPS as readonly string[]).indexOf(order.status);

  const steps = CUSTOMER_PROGRESS_STEPS.map((status, index): TimelineStep => {
    const at = order.times[TIME_OF[status]];
    let state: StepState;
    if (ended) {
      state = at ? "done" : "skipped";
    } else if (order.status === "pending_payment") {
      state = "upcoming";
    } else if (index < currentIndex || (index === currentIndex && status === "picked_up")) {
      state = "done";
    } else if (index === currentIndex) {
      state = "current";
    } else {
      state = "upcoming";
    }
    return { status, label: ORDER_STATUS_LABELS[status], at: state === "upcoming" || state === "skipped" ? null : at, state };
  });

  let outcome: TimelineOutcome | null = null;
  if (order.status === "cancelled") {
    outcome = {
      kind: "cancelled",
      title: "Order cancelled",
      reason: plainCancellationReason(order.cancellationReason),
      refund: refundSentence(order.payment),
      at: order.times.cancelled,
    };
  } else if (order.status === "refunded") {
    const pickedUp = Boolean(order.times.pickedUp);
    outcome = {
      kind: "refunded",
      title: "Order refunded",
      // A cancel reason explains a refund before pickup; after pickup there
      // is none on the order.
      reason: pickedUp ? null : plainCancellationReason(order.cancellationReason),
      refund: refundSentence(order.payment),
      at: order.times.refunded ?? order.times.cancelled,
    };
  }

  return { steps, outcome };
}

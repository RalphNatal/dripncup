/**
 * The order lifecycle, mirrored from the database.
 *
 * `is_valid_order_transition()` in SQL is the enforcing copy -- it runs no
 * matter which codepath makes the change. This module exists so the UI can grey
 * out impossible buttons without a round trip, and is covered by a test that
 * pins the two in step.
 */
import type { Database } from "@/types/database";

export type OrderStatus = Database["public"]["Enums"]["order_status"];

/** Allowed next states, keyed by current state. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["placed", "cancelled"],
  placed: ["accepted", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["picked_up", "cancelled"],
  picked_up: ["refunded"],
  cancelled: ["refunded"],
  refunded: [],
} as const;

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * The happy path shown as a progress indicator to the customer.
 * `pending_payment` is omitted: the customer never sees it, because an order
 * only becomes visible once Stripe confirms payment.
 */
export const CUSTOMER_PROGRESS_STEPS = [
  "placed",
  "accepted",
  "preparing",
  "ready",
  "picked_up",
] as const satisfies readonly OrderStatus[];

export type CustomerProgressStep = (typeof CUSTOMER_PROGRESS_STEPS)[number];

/** -1 when the order is cancelled, refunded or still unpaid. */
export function progressIndex(status: OrderStatus): number {
  return (CUSTOMER_PROGRESS_STEPS as readonly OrderStatus[]).indexOf(status);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  placed: "Placed",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready for pickup",
  picked_up: "Picked up",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** Friendlier second line for the tracker. */
export const ORDER_STATUS_DESCRIPTIONS: Record<OrderStatus, string> = {
  pending_payment: "Finishing up your payment.",
  placed: "We got your order! Hanging tight for the counter to pick it up.",
  accepted: "The team has your order.",
  preparing: "Your drinks are being made right now.",
  ready: "Ready! Come grab it from the pickup shelf.",
  picked_up: "Mahalo! Hope it hit the spot.",
  cancelled: "This order was cancelled.",
  refunded: "This order was refunded.",
};

/** Columns on the barista Kanban board. */
export const STAFF_QUEUE_COLUMNS = [
  { status: "placed", label: "New" },
  { status: "preparing", label: "Preparing" },
  { status: "ready", label: "Ready" },
] as const satisfies readonly { status: OrderStatus; label: string }[];

/** True once the order has left the queue, one way or another. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0 || status === "picked_up" || status === "cancelled";
}

/** Orders in these states belong on the live queue. */
export const ACTIVE_ORDER_STATUSES = ["placed", "accepted", "preparing", "ready"] as const satisfies
  readonly OrderStatus[];

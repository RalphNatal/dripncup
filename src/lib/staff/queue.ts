/**
 * The barista queue: which column a ticket sits in, in what order, and how
 * late it is running.
 *
 * Pure and isomorphic: everything, including `now`, is passed in, so the
 * rules are unit-tested at exact instants and the dashboard re-runs them
 * every second without a round trip. Nothing here writes; status changes go
 * through advance_order_status() in the database.
 */
import type { SnapshotModifier } from "@/lib/orders/detail";
import type { OrderStatus } from "@/lib/order-status";

export interface StaffOrderItem {
  id: string;
  productId: string | null;
  name: string;
  sizeName: string | null;
  quantity: number;
  modifiers: SnapshotModifier[];
  specialInstructions: string | null;
  /** Rewards on this line ("Free drink", "Free add-on: Vanilla"), so the barista knows it is on the house. */
  rewards?: string[];
}

/** One order as the staff screen holds it. */
export interface StaffOrder {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  cupName: string | null;
  notes: string | null;
  pickupType: "asap" | "scheduled";
  scheduledFor: string | null;
  estimatedReadyAt: string | null;
  createdAt: string;
  placedAt: string | null;
  acceptedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  items: StaffOrderItem[];
}

export type QueueColumn = "upcoming" | "new" | "in_progress" | "ready";

export const QUEUE_COLUMNS: readonly { id: QueueColumn; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "new", label: "New" },
  { id: "in_progress", label: "In progress" },
  { id: "ready", label: "Ready" },
];

const MINUTE = 60_000;

function time(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * When a placed order belongs in New: straight away for ASAP, and for a
 * scheduled pickup, the pickup time minus the location's prep time.
 */
export function dueAt(order: Pick<StaffOrder, "pickupType" | "scheduledFor" | "placedAt" | "createdAt">, prepMinutes: number): Date {
  const scheduled = order.pickupType === "scheduled" ? time(order.scheduledFor) : null;
  if (scheduled !== null) return new Date(scheduled - prepMinutes * MINUTE);
  return new Date(time(order.placedAt) ?? time(order.createdAt) ?? 0);
}

/** The column for an order right now, or null if it is not on the live queue. */
export function assignColumn(
  order: Pick<StaffOrder, "status" | "pickupType" | "scheduledFor" | "placedAt" | "createdAt">,
  now: Date,
  prepMinutes: number,
): QueueColumn | null {
  switch (order.status) {
    case "placed":
      return now.getTime() < dueAt(order, prepMinutes).getTime() ? "upcoming" : "new";
    case "accepted":
    case "preparing":
      return "in_progress";
    case "ready":
      return "ready";
    default:
      return null;
  }
}

/** Sort key: the pickup time; ASAP orders count from when they were placed. */
export function pickupSortKey(order: Pick<StaffOrder, "pickupType" | "scheduledFor" | "placedAt" | "createdAt">): number {
  const scheduled = order.pickupType === "scheduled" ? time(order.scheduledFor) : null;
  return scheduled ?? time(order.placedAt) ?? time(order.createdAt) ?? 0;
}

export type Queue = Record<QueueColumn, StaffOrder[]>;

/** Every live order in its column, earliest pickup first (ties by order number). */
export function buildQueue(orders: readonly StaffOrder[], now: Date, prepMinutes: number): Queue {
  const queue: Queue = { upcoming: [], new: [], in_progress: [], ready: [] };
  for (const order of orders) {
    const column = assignColumn(order, now, prepMinutes);
    if (column) queue[column].push(order);
  }
  for (const column of Object.keys(queue) as QueueColumn[]) {
    queue[column].sort((a, b) => pickupSortKey(a) - pickupSortKey(b) || a.orderNumber.localeCompare(b.orderNumber));
  }
  return queue;
}

// ---------------------------------------------------------------------------
// Running late.
// ---------------------------------------------------------------------------

export interface UrgencyThresholds {
  /** Minutes past the estimated ready time before a ticket turns amber. */
  warningMinutes: number;
  /** Minutes past the estimated ready time before it turns red. */
  lateMinutes: number;
}

export const DEFAULT_THRESHOLDS: UrgencyThresholds = { warningMinutes: 5, lateMinutes: 10 };

export type Urgency = "ok" | "warning" | "late";

/**
 * When the customer expects the drinks: the scheduled time, or the ASAP
 * estimate quoted at checkout (placed + prep time if that is missing).
 */
export function targetReadyAt(
  order: Pick<StaffOrder, "pickupType" | "scheduledFor" | "estimatedReadyAt" | "placedAt" | "createdAt">,
  prepMinutes: number,
): Date {
  const scheduled = order.pickupType === "scheduled" ? time(order.scheduledFor) : null;
  if (scheduled !== null) return new Date(scheduled);
  const estimate = time(order.estimatedReadyAt);
  if (estimate !== null) return new Date(estimate);
  return new Date((time(order.placedAt) ?? time(order.createdAt) ?? 0) + prepMinutes * MINUTE);
}

/**
 * Amber, then red, once a ticket still being made runs past its estimated
 * ready time by the thresholds. Ready and finished tickets are never late:
 * the drinks are made.
 */
export function ticketUrgency(
  order: Pick<StaffOrder, "status" | "pickupType" | "scheduledFor" | "estimatedReadyAt" | "placedAt" | "createdAt">,
  now: Date,
  prepMinutes: number,
  thresholds: UrgencyThresholds = DEFAULT_THRESHOLDS,
): Urgency {
  if (order.status !== "placed" && order.status !== "accepted" && order.status !== "preparing") return "ok";
  const overMinutes = (now.getTime() - targetReadyAt(order, prepMinutes).getTime()) / MINUTE;
  if (overMinutes >= thresholds.lateMinutes) return "late";
  if (overMinutes >= thresholds.warningMinutes) return "warning";
  return "ok";
}

/** "0:42", "12:05", "1:04:10" -- time since `from`, never negative. */
export function formatElapsed(from: Date, now: Date): string {
  const total = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}

// ---------------------------------------------------------------------------
// Today's summary strip. No money: the staff screen shows no revenue.
// ---------------------------------------------------------------------------

export interface QueueSummary {
  /** Paid orders placed today (any status now). */
  ordersToday: number;
  /** Mean minutes from entering New (placed, or due for scheduled orders) to Ready; null before the first. */
  averageMinutesToReady: number | null;
  /** In New or In progress right now. */
  waiting: number;
}

export function summarise(
  orders: readonly StaffOrder[],
  queue: Queue,
  { todayStart, prepMinutes }: { todayStart: Date; prepMinutes: number },
): QueueSummary {
  const today = orders.filter((o) => (time(o.placedAt) ?? -Infinity) >= todayStart.getTime());
  const durations = today.flatMap((o) => {
    const ready = time(o.readyAt);
    if (ready === null) return [];
    // A scheduled order placed last night should not count as a 12-hour wait.
    const start = Math.max(time(o.placedAt) ?? 0, dueAt(o, prepMinutes).getTime());
    return [Math.max(0, ready - start) / MINUTE];
  });
  return {
    ordersToday: today.length,
    averageMinutesToReady: durations.length
      ? Math.round((durations.reduce((sum, d) => sum + d, 0) / durations.length) * 10) / 10
      : null,
    waiting: queue.new.length + queue.in_progress.length,
  };
}

// ---------------------------------------------------------------------------
// One-tap actions.
// ---------------------------------------------------------------------------

export interface TicketAction {
  to: "accepted" | "preparing" | "ready" | "picked_up";
  label: string;
  /** Present for the moves that notify or close out a customer: a 5-second undo window. */
  pendingLabel?: string;
}

/** The single forward move for an order on the queue, or null. */
export function nextAction(status: OrderStatus): TicketAction | null {
  switch (status) {
    case "placed":
      return { to: "accepted", label: "Accept" };
    case "accepted":
      return { to: "preparing", label: "Start" };
    case "preparing":
      return { to: "ready", label: "Ready", pendingLabel: "Marking ready…" };
    case "ready":
      return { to: "picked_up", label: "Picked up", pendingLabel: "Marking picked up…" };
    default:
      return null;
  }
}

/** How long a Ready or Picked up tap can be undone before it is sent. */
export const UNDO_WINDOW_MS = 5_000;

/** Statuses a ticket can still be cancelled from (with a refund if paid). */
export function isCancellable(status: OrderStatus): boolean {
  return status === "placed" || status === "accepted" || status === "preparing" || status === "ready";
}

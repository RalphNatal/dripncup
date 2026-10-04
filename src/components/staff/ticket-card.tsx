"use client";

/**
 * One order on the queue. Built for a counter tablet and wet hands: the cup
 * name and order number are the biggest things on it, every selection has its
 * own line in build order, notes and special instructions are boxed so they
 * cannot be missed, and the one forward action is a full-width 64px button.
 * Tapping anywhere else on the card opens the detail view.
 */
import { AlertTriangle, BellRing, CalendarClock, Clock, Gift, MessageSquareWarning, Undo2 } from "lucide-react";

import { ALLERGENS } from "@/components/menu/dietary";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import {
  dueAt,
  formatElapsed,
  nextAction,
  type QueueColumn,
  type StaffOrder,
  type Urgency,
} from "@/lib/staff/queue";
import { itemAllergens, ticketLines, type CatalogMeta } from "@/lib/staff/ticket";

export interface PendingAction {
  to: "ready" | "picked_up";
  label: string;
  deadline: number;
}

/** "DC-261003-<b>0042</b>": the daily sequence is what people call out. */
export function OrderNumber({ value, className }: { value: string; className?: string }) {
  const split = value.lastIndexOf("-");
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>
      {split > 0 ? <span className="font-semibold opacity-70">{value.slice(0, split + 1)}</span> : null}
      <span className="font-extrabold">{split > 0 ? value.slice(split + 1) : value}</span>
    </span>
  );
}

const URGENCY_STYLES: Record<Urgency, string> = {
  ok: "border-border bg-card",
  warning: "border-warning bg-[color-mix(in_oklab,var(--warning)_12%,var(--card))]",
  late: "border-destructive bg-[color-mix(in_oklab,var(--destructive)_12%,var(--card))]",
};

export function TicketItems({ order, meta }: { order: StaffOrder; meta: CatalogMeta }) {
  return (
    <ul className="space-y-3" aria-label="Items">
      {order.items.map((item) => {
        const allergens = itemAllergens(item, meta);
        return (
          <li key={item.id} data-testid="ticket-item">
            <p className="text-xl leading-tight font-bold">
              <span className="tabular mr-1.5 inline-block min-w-8 rounded-md bg-brand-ink px-1.5 text-center text-white">
                {item.quantity}×
              </span>
              {item.name}
              {item.sizeName ? <span className="font-semibold text-muted-foreground"> · {item.sizeName}</span> : null}
            </p>
            {item.modifiers.length ? (
              <ul className="mt-1 space-y-0.5 pl-11 text-lg leading-snug">
                {ticketLines(item.modifiers, meta.groups).map((line, index) => (
                  <li key={index} data-testid="ticket-selection">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
            {item.rewards?.map((reward) => (
              <p
                key={reward}
                data-testid="ticket-reward"
                className="mt-1.5 ml-11 flex w-fit items-center gap-1.5 rounded-lg bg-brand-magenta-deep px-2.5 py-1 text-lg font-extrabold text-white"
              >
                <Gift className="size-5" aria-hidden="true" />
                REWARD · {reward}
              </p>
            ))}
            {item.specialInstructions ? (
              <p
                data-testid="special-instructions"
                className="mt-1.5 ml-11 rounded-lg border-2 border-brand-magenta-deep bg-brand-pink-soft px-2.5 py-1.5 text-lg font-bold text-brand-ink"
              >
                <MessageSquareWarning className="mr-1.5 inline size-5 align-[-3px] text-brand-magenta-deep" aria-hidden="true" />
                {item.specialInstructions}
              </p>
            ) : null}
            {allergens.length ? (
              <p className="mt-1.5 ml-11 flex flex-wrap gap-1.5" data-testid="allergens">
                <span className="sr-only">Allergens:</span>
                {allergens.map((allergen) => (
                  <span
                    key={allergen}
                    className="inline-flex items-center gap-1 rounded-full border-2 border-destructive px-2 py-0.5 text-sm font-bold text-destructive"
                  >
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    {ALLERGENS[allergen].label}
                  </span>
                ))}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function TicketCard({
  order,
  column,
  now,
  prepMinutes,
  urgency,
  meta,
  unacknowledged,
  pending,
  busy,
  onAction,
  onUndo,
  onOpen,
}: {
  order: StaffOrder;
  column: QueueColumn;
  now: Date;
  prepMinutes: number;
  urgency: Urgency;
  meta: CatalogMeta;
  unacknowledged: boolean;
  pending: PendingAction | undefined;
  busy: boolean;
  onAction: (order: StaffOrder) => void;
  onUndo: (order: StaffOrder) => void;
  onOpen: (order: StaffOrder) => void;
}) {
  const action = nextAction(order.status);
  const scheduled = order.pickupType === "scheduled" && order.scheduledFor ? new Date(order.scheduledFor) : null;
  const placed = order.placedAt ? new Date(order.placedAt) : new Date(order.createdAt);
  const secondsLeft = pending ? Math.max(0, Math.ceil((pending.deadline - now.getTime()) / 1000)) : 0;

  return (
    <article
      data-testid="ticket"
      data-order-number={order.orderNumber}
      data-status={order.status}
      data-urgency={urgency}
      data-unacknowledged={unacknowledged ? "true" : undefined}
      aria-label={`Order ${order.orderNumber} for ${order.cupName ?? "no name"}`}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl border-[3px] shadow-sm",
        URGENCY_STYLES[urgency],
        unacknowledged && "staff-flash",
        pending && "opacity-80",
      )}
    >
      {/* The whole card opens the detail view. An overlay button rather than
          wrapping the content, so the ticket still reads as text to a screen
          reader; the action bar sits above it. */}
      <button
        type="button"
        onClick={() => onOpen(order)}
        className="focus-ring absolute inset-0 z-10 rounded-[inherit]"
        aria-label={`Open order ${order.orderNumber} for ${order.cupName ?? "no name"}`}
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-heading text-3xl leading-none font-extrabold" data-testid="cup-name">
              {order.cupName ?? "No name"}
            </p>
            <OrderNumber value={order.orderNumber} className="mt-1 block text-base xl:text-lg" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {unacknowledged ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-magenta-deep px-2.5 py-1 text-sm font-extrabold text-white">
                <BellRing className="size-4" aria-hidden="true" /> NEW
              </span>
            ) : null}
            {column === "in_progress" ? (
              <span
                data-testid="progress-badge"
                className={cn(
                  "rounded-full px-3 py-1 text-base font-bold",
                  order.status === "preparing" ? "bg-brand-teal-deep text-white" : "bg-brand-teal-soft text-brand-teal-deep",
                )}
              >
                {ORDER_STATUS_LABELS[order.status]}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 text-lg font-bold">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1",
              scheduled ? "bg-brand-ink text-white" : "bg-muted",
            )}
            data-testid="pickup"
          >
            {scheduled ? <CalendarClock className="size-5" aria-hidden="true" /> : null}
            {scheduled ? formatCafeTimeOfDay(scheduled) : "ASAP"}
          </span>
          {column === "upcoming" ? (
            <span className="text-base font-semibold text-muted-foreground">
              Due in queue {formatCafeTimeOfDay(dueAt(order, prepMinutes))}
            </span>
          ) : (
            <span className="tabular inline-flex items-center gap-1.5" aria-label={`Waiting ${formatElapsed(placed, now)}`}>
              <Clock className="size-5" aria-hidden="true" />
              {formatElapsed(placed, now)}
            </span>
          )}
          {urgency !== "ok" ? (
            <span
              className={cn(
                "rounded-lg px-2 py-0.5 text-base font-extrabold text-white",
                urgency === "late" ? "bg-destructive" : "bg-warning",
              )}
            >
              {urgency === "late" ? "LATE" : "Running behind"}
            </span>
          ) : null}
        </div>

        {order.notes ? (
          <p
            data-testid="order-notes"
            className="w-full rounded-lg border-2 border-brand-magenta-deep bg-brand-pink-soft px-3 py-2 text-lg font-bold"
          >
            <MessageSquareWarning className="mr-1.5 inline size-5 align-[-3px] text-brand-magenta-deep" aria-hidden="true" />
            Note: {order.notes}
          </p>
        ) : null}

        <TicketItems order={order} meta={meta} />
      </div>

      {pending ? (
        <div className="relative z-20 flex items-center gap-2 border-t bg-brand-ink p-2 text-white" role="status">
          <p className="flex-1 pl-2 text-lg font-bold">
            {pending.label} <span className="tabular">{secondsLeft}</span>
          </p>
          <button
            type="button"
            onClick={() => onUndo(order)}
            className="focus-ring inline-flex min-h-16 items-center gap-2 rounded-xl bg-white px-6 text-xl font-extrabold text-brand-ink"
          >
            <Undo2 className="size-6" aria-hidden="true" /> Undo
          </button>
        </div>
      ) : action ? (
        <div className="relative z-20 border-t p-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(order)}
            className={cn(
              "focus-ring min-h-16 w-full rounded-xl text-2xl font-extrabold transition-colors disabled:opacity-60",
              column === "upcoming"
                ? "border-2 border-brand-teal-deep bg-card text-brand-teal-deep"
                : order.status === "preparing"
                  ? "bg-brand-magenta-deep text-white"
                  : "bg-brand-teal-deep text-white",
            )}
          >
            {column === "upcoming" ? "Accept early" : action.label}
          </button>
        </div>
      ) : null}
    </article>
  );
}

"use client";

/**
 * One order on the queue, built to be read at arm's length on a counter
 * tablet and worked with wet hands.
 *
 *   1  Cup name (largest), the order's daily number beside it
 *   2  Pickup (ASAP or the time), the timer ("4m", "12m late"), progress
 *   3  Items: quantity, drink and size in bold, then every selection in
 *      build order
 *   4  Notes and special instructions boxed; allergen and reward pills
 *   5  One forward action, full width
 *
 * The card stays neutral. How late it is running shows as a stripe down its
 * left edge and the colour of its timer chip (amber, then red), with words
 * in the chip as well, so a rush of late orders doesn't turn the whole screen
 * red. Tapping anywhere else opens the detail view, which holds printing and
 * Cancel.
 */
import { AlertTriangle, CalendarClock, Clock, Flame, Gift, MessageSquareText, Undo2 } from "lucide-react";

import { ALLERGENS } from "@/components/menu/dietary";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import {
  dueAt,
  nextAction,
  ticketTimer,
  type QueueColumn,
  type StaffOrder,
  type TicketAction,
  type Urgency,
} from "@/lib/staff/queue";
import { itemAllergens, ticketLines, type CatalogMeta } from "@/lib/staff/ticket";

import type { Density } from "./device";

export interface PendingAction {
  to: "ready" | "picked_up";
  label: string;
  deadline: number;
}

/** "DC-261003-<b>0042</b>": the daily sequence is what people call out. */
export function OrderNumber({ value, className }: { value: string; className?: string }) {
  const split = value.lastIndexOf("-");
  return (
    <span className={cn("font-mono tabular whitespace-nowrap", className)}>
      {split > 0 ? <span className="font-medium text-muted-foreground">{value.slice(0, split + 1)}</span> : null}
      <span className="font-bold">{split > 0 ? value.slice(split + 1) : value}</span>
    </span>
  );
}

/** The daily sequence alone ("#0042"), with the full number on hover and in the card's name. */
function ShortNumber({ value, className }: { value: string; className?: string }) {
  const split = value.lastIndexOf("-");
  return (
    <span className={cn("font-mono tabular whitespace-nowrap", className)} title={value}>
      #{split > 0 ? value.slice(split + 1) : value}
    </span>
  );
}

/** One colour per forward action, the same on every ticket. */
const ACTION_STYLES: Record<TicketAction["to"], string> = {
  accepted: "bg-staff-fill-new text-white",
  preparing: "bg-staff-fill-start text-white",
  ready: "bg-staff-fill-ready text-white",
  picked_up: "bg-staff-fill-done text-staff-fill-done-fg",
};

const STRIPE: Record<Urgency, string | null> = {
  ok: null,
  warning: "bg-staff-warn",
  late: "bg-staff-late",
};

export function TicketItems({
  order,
  meta,
  density = "comfortable",
}: {
  order: StaffOrder;
  meta: CatalogMeta;
  density?: Density;
}) {
  const compact = density === "compact";
  const indent = compact ? "ml-8" : "ml-9";
  return (
    <ul className={compact ? "space-y-1.5" : "space-y-2.5"} aria-label="Items">
      {order.items.map((item) => {
        const allergens = itemAllergens(item, meta);
        const lines = ticketLines(item.modifiers, meta.groups);
        return (
          <li key={item.id} data-testid="ticket-item">
            <p className={cn("flex items-baseline gap-2 leading-snug font-bold", compact ? "text-base" : "text-lg")}>
              <span
                className={cn(
                  "tabular inline-flex shrink-0 justify-center rounded-md bg-foreground px-1 font-extrabold text-background",
                  compact ? "min-w-6 text-sm" : "min-w-7 text-base",
                )}
              >
                {item.quantity}×
              </span>
              <span className="min-w-0">
                {item.name}
                {item.sizeName ? <span className="font-semibold text-muted-foreground"> · {item.sizeName}</span> : null}
              </span>
            </p>
            {lines.length ? (
              <ul
                className={cn(
                  indent,
                  "leading-snug",
                  compact
                    ? "mt-0.5 flex flex-wrap gap-x-1.5 text-sm [&>li:not(:last-child)]:after:ml-1.5 [&>li:not(:last-child)]:after:text-muted-foreground [&>li:not(:last-child)]:after:content-['·']"
                    : "mt-0.5 space-y-px text-base",
                )}
              >
                {lines.map((line, index) => (
                  <li key={index} data-testid="ticket-selection">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
            {item.specialInstructions ? (
              <p
                data-testid="special-instructions"
                className={cn(
                  indent,
                  "mt-1.5 flex gap-1.5 rounded-md border-l-4 border-staff-note-line bg-staff-note-soft px-2 py-1 font-bold",
                  compact ? "text-sm" : "text-base",
                )}
              >
                <MessageSquareText className="mt-0.5 size-4 shrink-0 text-staff-note" aria-hidden="true" />
                {item.specialInstructions}
              </p>
            ) : null}
            {item.rewards?.length || allergens.length ? (
              <div className={cn(indent, "mt-1.5 flex flex-wrap gap-1")}>
                {item.rewards?.map((reward) => (
                  <span
                    key={reward}
                    data-testid="ticket-reward"
                    className="inline-flex items-center gap-1 rounded-full bg-staff-fill-new px-2 py-0.5 text-sm font-extrabold text-white"
                  >
                    <Gift className="size-3.5" aria-hidden="true" />
                    REWARD · {reward}
                  </span>
                ))}
                {allergens.length ? (
                  <span className="contents" data-testid="allergens">
                    <span className="sr-only">Allergens:</span>
                    {allergens.map((allergen) => (
                      <span
                        key={allergen}
                        className="inline-flex items-center gap-1 rounded-full bg-staff-chip px-2 py-0.5 text-xs font-bold"
                      >
                        <AlertTriangle className="size-3 text-staff-late" aria-hidden="true" />
                        {ALLERGENS[allergen].label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** The pickup chip and the timer chip, shared by the card and nothing else. */
function TimeChips({
  order,
  column,
  now,
  prepMinutes,
  urgency,
  compact,
}: {
  order: StaffOrder;
  column: QueueColumn;
  now: Date;
  prepMinutes: number;
  urgency: Urgency;
  compact: boolean;
}) {
  const scheduled = order.pickupType === "scheduled" && order.scheduledFor ? new Date(order.scheduledFor) : null;
  const chip = cn("inline-flex items-center gap-1 rounded-md font-bold whitespace-nowrap", compact ? "px-1.5 py-0.5 text-sm" : "px-2 py-0.5 text-base");
  const timer = ticketTimer(order, now, prepMinutes);
  return (
    <>
      <span className={cn(chip, scheduled ? "bg-foreground text-background" : "bg-staff-chip")} data-testid="pickup">
        {scheduled ? <CalendarClock className="size-4" aria-hidden="true" /> : null}
        {scheduled ? formatCafeTimeOfDay(scheduled) : "ASAP"}
      </span>
      {column === "upcoming" ? (
        <span className={cn(chip, "bg-transparent px-0 font-semibold text-muted-foreground")}>
          Due {formatCafeTimeOfDay(dueAt(order, prepMinutes))}
        </span>
      ) : (
        <span
          className={cn(
            chip,
            "tabular",
            urgency === "late"
              ? "bg-staff-late-soft text-staff-late"
              : urgency === "warning"
                ? "bg-staff-warn-soft text-staff-warn"
                : "bg-staff-chip",
          )}
          data-testid="ticket-timer"
          data-kind={timer.kind}
        >
          <span className="sr-only">
            {urgency === "late" ? `${timer.label}, late` : urgency === "warning" ? `${timer.label}, running behind` : timer.label}
          </span>
          {urgency === "late" ? (
            <Flame className="size-4" aria-hidden="true" />
          ) : urgency === "warning" ? (
            <AlertTriangle className="size-4" aria-hidden="true" />
          ) : (
            <Clock className="size-4 opacity-70" aria-hidden="true" />
          )}
          <span aria-hidden="true">{timer.text}</span>
        </span>
      )}
    </>
  );
}

export function TicketCard({
  order,
  column,
  now,
  prepMinutes,
  urgency,
  meta,
  density,
  unacknowledged,
  selected,
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
  density: Density;
  unacknowledged: boolean;
  /** Showing in the detail panel right now. */
  selected: boolean;
  pending: PendingAction | undefined;
  busy: boolean;
  onAction: (order: StaffOrder) => void;
  onUndo: (order: StaffOrder) => void;
  onOpen: (order: StaffOrder) => void;
}) {
  const compact = density === "compact";
  const action = nextAction(order.status);
  const secondsLeft = pending ? Math.max(0, Math.ceil((pending.deadline - now.getTime()) / 1000)) : 0;
  const stripe = STRIPE[urgency];
  const name = `Order ${order.orderNumber} for ${order.cupName ?? "no name"}`;
  const badges = (
    <>
      {column === "in_progress" ? (
        <span
          data-testid="progress-badge"
          className={cn(
            "rounded-md px-2 py-0.5 font-bold",
            compact ? "text-sm" : "text-base",
            order.status === "preparing" ? "bg-brand-teal-soft text-staff-accent" : "border border-staff-line text-muted-foreground",
          )}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      ) : null}
      {unacknowledged ? (
        <span className="rounded-md bg-staff-fill-new px-2 py-0.5 text-sm font-extrabold tracking-wide text-white">NEW</span>
      ) : null}
    </>
  );

  return (
    <article
      data-testid="ticket"
      data-ticket-id={order.id}
      data-order-number={order.orderNumber}
      data-status={order.status}
      data-urgency={urgency}
      data-unacknowledged={unacknowledged ? "true" : undefined}
      aria-label={name}
      // Focused by the arrow keys (shortcuts.tsx): Enter then takes the forward action.
      tabIndex={-1}
      className={cn(
        "staff-enter relative flex scroll-my-16 flex-col overflow-hidden rounded-xl border border-staff-line bg-staff-card shadow-[0_1px_2px_rgb(0_0_0/0.06)]",
        "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-staff-accent",
        selected && "ring-3 ring-staff-accent",
        unacknowledged && "staff-flash",
        pending && "opacity-80",
      )}
    >
      {stripe ? <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-1.5", stripe)} /> : null}
      {/* The whole card opens the detail view. An overlay button rather than
          wrapping the content, so the ticket still reads as text to a screen
          reader; the action bar sits above it. */}
      <button
        type="button"
        tabIndex={0}
        onClick={() => onOpen(order)}
        className="focus-ring absolute inset-0 z-10 rounded-[inherit]"
        aria-label={`Open order ${order.orderNumber} for ${order.cupName ?? "no name"}`}
      />
      <div className={cn("flex flex-1 flex-col", compact ? "gap-1.5 py-2 pr-2.5 pl-3.5" : "gap-2 py-3 pr-3 pl-4")}>
        <div className={cn("flex min-w-0 gap-x-2", compact ? "flex-wrap items-center gap-y-1" : "items-baseline")}>
          <p
            className={cn(
              "min-w-0 truncate font-heading leading-tight font-extrabold",
              compact ? "max-w-full text-xl" : "flex-1 text-2xl",
            )}
            data-testid="cup-name"
          >
            {order.cupName ?? "No name"}
          </p>
          <ShortNumber value={order.orderNumber} className={cn("shrink-0 text-muted-foreground", compact ? "text-sm" : "text-base")} />
          {compact ? (
            // Compact: everything on the cup name's line, wrapping only when it must.
            <span className="ml-auto flex flex-wrap items-center gap-1">
              <TimeChips order={order} column={column} now={now} prepMinutes={prepMinutes} urgency={urgency} compact />
              {badges}
            </span>
          ) : null}
        </div>

        {compact ? null : (
          <div className="flex flex-wrap items-center gap-1.5">
            <TimeChips order={order} column={column} now={now} prepMinutes={prepMinutes} urgency={urgency} compact={false} />
            {badges}
          </div>
        )}

        {order.notes ? (
          <p
            data-testid="order-notes"
            className={cn(
              "flex gap-1.5 rounded-md border-l-4 border-staff-note-line bg-staff-note-soft px-2 py-1 font-bold",
              compact ? "text-sm" : "text-base",
            )}
          >
            <MessageSquareText className="mt-0.5 size-4 shrink-0 text-staff-note" aria-hidden="true" />
            <span>
              <span className="text-staff-note">Note:</span> {order.notes}
            </span>
          </p>
        ) : null}

        <TicketItems order={order} meta={meta} density={density} />
      </div>

      {pending ? (
        <div className={cn("relative z-20", compact ? "p-1.5 pt-0" : "p-2 pt-0")}>
          <div className="flex items-center gap-2 rounded-lg bg-foreground py-1 pr-1 pl-3 text-background" role="status">
            <p className="flex-1 text-base font-bold">
              {pending.label} <span className="tabular">{secondsLeft}</span>
            </p>
            <button
              type="button"
              onClick={() => onUndo(order)}
              className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-md bg-background px-5 text-lg font-extrabold text-foreground"
            >
              <Undo2 className="size-5" aria-hidden="true" /> Undo
            </button>
          </div>
        </div>
      ) : action ? (
        <div className={cn("relative z-20", compact ? "p-1.5 pt-0" : "p-2 pt-0")}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(order)}
            data-action={column === "upcoming" ? "accept-early" : action.to}
            className={cn(
              "focus-ring w-full rounded-lg font-extrabold transition-[filter,opacity] duration-150 hover:brightness-110 active:brightness-95 disabled:opacity-60",
              compact ? "min-h-14 text-lg" : "min-h-16 text-xl",
              column === "upcoming" ? "border-2 border-staff-line bg-transparent text-foreground" : ACTION_STYLES[action.to],
            )}
          >
            {column === "upcoming" ? "Accept early" : action.label}
          </button>
        </div>
      ) : null}
    </article>
  );
}

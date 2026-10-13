"use client";

/**
 * A ticket opened up: the whole order, who did what and when, printing, and
 * Cancel. Cancelling asks for a reason from the presets (Other needs a few
 * words) and then says plainly whether the customer gets money back and how
 * much, before anything happens. It always goes through the server's
 * cancel-with-refund flow; the customer's tracker and the cancellation email
 * follow from the status change.
 *
 * Where it opens depends on the screen:
 *   panel        1280 px and wider: docked beside the queue, which stays
 *                visible and usable (a non-modal dialog; Escape closes it)
 *   sheet        tablets: slides over the right of the queue (modal)
 *   fullscreen   phones: the whole screen (modal)
 */
import { useQuery } from "@tanstack/react-query";
import { Ban, Printer, Tags, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { formatCents } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { fetchOrderActivity, type OrderActivity } from "@/lib/staff/client";
import { isCancellable, type StaffOrder } from "@/lib/staff/queue";
import type { CatalogMeta } from "@/lib/staff/ticket";

import type { Density } from "./device";
import { OrderNumber, TicketItems } from "./ticket-card";

export type DetailVariant = "panel" | "sheet" | "fullscreen";

export const CANCEL_REASONS = [
  "Out of ingredient",
  "Customer request",
  "Duplicate order",
  "Unable to fulfill",
  "Other",
] as const;

function actorText(entry: OrderActivity["history"][number]): string {
  if (entry.actorName) return entry.actorRole === "admin" ? `${entry.actorName} (admin)` : entry.actorName;
  if (entry.toStatus === "placed") return "Payment confirmed";
  return "System";
}

interface DetailProps {
  order: StaffOrder | null;
  meta: CatalogMeta;
  density: Density;
  variant: DetailVariant;
  onClose: () => void;
  onPrint: (kind: "ticket" | "labels", order: StaffOrder) => void;
  /** Resolves true when the order was cancelled (or already was), so the view can close. */
  onCancel: (order: StaffOrder, reason: string, refundableCents: number) => Promise<boolean>;
}

/** The title and description: Radix's (wired to the modal) or plain elements with ids (the docked panel). */
interface Heading {
  title: (props: { className: string; children: ReactNode }) => ReactNode;
  description: (props: { className: string; children: ReactNode }) => ReactNode;
}

const CLOSE_BUTTON =
  "focus-ring inline-flex size-14 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground";

export function TicketDetail(props: DetailProps) {
  return props.variant === "panel" ? <DetailPanel {...props} /> : <DetailDialog {...props} />;
}

const DIALOG_HEADING: Heading = {
  title: (props) => <DialogPrimitive.Title {...props} />,
  description: ({ className, children }) => (
    <DialogPrimitive.Description asChild>
      <div className={className}>{children}</div>
    </DialogPrimitive.Description>
  ),
};

/** Tablets and phones: a modal over the queue. */
function DetailDialog({ order, meta, density, variant, onClose, onPrint, onCancel }: DetailProps) {
  return (
    <DialogPrimitive.Root open={order !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          data-testid="ticket-detail"
          data-variant={variant}
          className={cn(
            "fixed z-50 flex flex-col bg-staff-card text-foreground shadow-2xl outline-none duration-150 data-open:animate-in data-closed:animate-out",
            variant === "fullscreen"
              ? "inset-0 data-open:fade-in-0 data-closed:fade-out-0"
              : "inset-y-0 right-0 w-[min(36rem,92vw)] border-l border-staff-line data-open:slide-in-from-right-8 data-closed:slide-out-to-right-8",
          )}
        >
          {order ? (
            <DetailBody
              key={order.id}
              order={order}
              meta={meta}
              density={density}
              heading={DIALOG_HEADING}
              close={
                <DialogPrimitive.Close className={CLOSE_BUTTON} aria-label="Close">
                  <X className="size-7" aria-hidden="true" />
                </DialogPrimitive.Close>
              }
              onPrint={onPrint}
              onCancel={onCancel}
              onClose={onClose}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Wide screens: docked beside the queue. Focus moves into the panel when an
 * order opens; Escape or Close puts it back on that order's ticket.
 */
function DetailPanel({ order, meta, density, onClose, onPrint, onCancel }: DetailProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLElement>(null);
  const orderId = order?.id ?? null;

  useEffect(() => {
    if (orderId) panel.current?.focus({ preventScroll: true });
  }, [orderId]);

  if (!order) return null;

  const close = () => {
    onClose();
    document.querySelector<HTMLElement>(`[data-ticket-id="${order.id}"]`)?.focus({ preventScroll: true });
  };
  const heading: Heading = {
    title: ({ className, children }) => (
      <h2 id={titleId} className={className}>
        {children}
      </h2>
    ),
    description: ({ className, children }) => (
      <div id={descriptionId} className={className}>
        {children}
      </div>
    ),
  };

  return (
    <aside
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      tabIndex={-1}
      data-testid="ticket-detail"
      data-variant="panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          close();
        }
      }}
      className="staff-enter flex min-h-0 w-[26rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-staff-line bg-staff-card shadow-sm outline-none"
    >
      <DetailBody
        key={order.id}
        order={order}
        meta={meta}
        density={density}
        heading={heading}
        close={
          <button type="button" onClick={close} className={CLOSE_BUTTON} aria-label="Close">
            <X className="size-7" aria-hidden="true" />
          </button>
        }
        onPrint={onPrint}
        onCancel={onCancel}
        onClose={close}
      />
    </aside>
  );
}

const FOOTER_BUTTON =
  "focus-ring inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-staff-line bg-staff-card px-3 text-base font-bold";

function DetailBody({
  order,
  meta,
  density,
  heading,
  close,
  onPrint,
  onCancel,
  onClose,
}: {
  order: StaffOrder;
  meta: CatalogMeta;
  density: Density;
  heading: Heading;
  close: ReactNode;
  onPrint: (kind: "ticket" | "labels", order: StaffOrder) => void;
  onCancel: (order: StaffOrder, reason: string, refundableCents: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const activity = useQuery({
    queryKey: ["staff-order-activity", order.id, order.status],
    queryFn: () => fetchOrderActivity(order.id),
    staleTime: 0,
  });
  const scheduled = order.pickupType === "scheduled" && order.scheduledFor ? new Date(order.scheduledFor) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-2 border-b border-staff-line py-3 pr-2 pl-5">
        <div className="min-w-0 flex-1 space-y-1.5 pt-1">
          {heading.title({
            className: "font-heading text-3xl leading-tight font-extrabold break-words",
            children: order.cupName ?? "No name",
          })}
          {heading.description({
            className: "space-y-1.5 text-base text-foreground",
            children: (
              <>
                <OrderNumber value={order.orderNumber} className="block text-lg" />
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="rounded-md bg-staff-chip px-2 py-0.5 font-bold" data-testid="detail-status">
                    {ORDER_STATUS_LABELS[order.status]}
                  </span>
                  <span className="font-semibold">{scheduled ? `Pickup ${formatCafeTimeOfDay(scheduled)}` : "ASAP"}</span>
                  {order.placedAt ? (
                    <span className="text-muted-foreground">Placed {formatCafeTimeOfDay(new Date(order.placedAt))}</span>
                  ) : null}
                </span>
              </>
            ),
          })}
        </div>
        {close}
      </div>

      {cancelling ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CancelForm
            order={order}
            refundableCents={activity.data?.refundableCents ?? null}
            onBack={() => setCancelling(false)}
            onConfirm={async (reason) => {
              const done = await onCancel(order, reason, activity.data?.refundableCents ?? 0);
              if (done) onClose();
            }}
          />
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {order.cancellationReason ? (
              <p className="rounded-lg bg-staff-chip px-3 py-2 text-lg">
                <span className="font-bold">Cancelled:</span> {order.cancellationReason}
              </p>
            ) : null}
            {order.notes ? (
              <p className="rounded-md border-l-4 border-staff-note-line bg-staff-note-soft px-3 py-2 text-lg font-bold">
                <span className="text-staff-note">Note:</span> {order.notes}
              </p>
            ) : null}
            <TicketItems order={order} meta={meta} density={density} />

            <section aria-labelledby={`history-${order.id}`}>
              <h3 id={`history-${order.id}`} className="mb-2 text-xl font-bold">
                History
              </h3>
              {activity.isPending ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : activity.isError ? (
                <p className="text-staff-late">Couldn&apos;t load the history.</p>
              ) : (
                <ol className="space-y-1.5 text-lg" data-testid="status-history">
                  {activity.data.history
                    .filter((entry) => entry.toStatus !== "pending_payment")
                    .map((entry, index) => (
                      <li key={index} className="flex flex-wrap gap-x-3">
                        <span className="tabular w-24 shrink-0 text-muted-foreground">
                          {formatCafeTimeOfDay(new Date(entry.at))}
                        </span>
                        <span className="font-bold">{ORDER_STATUS_LABELS[entry.toStatus]}</span>
                        <span className="text-muted-foreground">{actorText(entry)}</span>
                        {entry.reason ? <span className="w-full pl-27">“{entry.reason}”</span> : null}
                      </li>
                    ))}
                </ol>
              )}
            </section>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-staff-line p-3">
            <button type="button" onClick={() => onPrint("ticket", order)} className={FOOTER_BUTTON}>
              <Printer className="size-5" aria-hidden="true" /> Print ticket
            </button>
            <button type="button" onClick={() => onPrint("labels", order)} className={FOOTER_BUTTON}>
              <Tags className="size-5" aria-hidden="true" /> Print cup labels
            </button>
            {isCancellable(order.status) ? (
              <button
                type="button"
                onClick={() => setCancelling(true)}
                className={cn(FOOTER_BUTTON, "col-span-2 border-staff-late/50 text-staff-late")}
              >
                <Ban className="size-5" aria-hidden="true" /> Cancel order
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function CancelForm({
  order,
  refundableCents,
  onBack,
  onConfirm,
}: {
  order: StaffOrder;
  refundableCents: number | null;
  onBack: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [preset, setPreset] = useState<(typeof CANCEL_REASONS)[number] | null>(null);
  const [other, setOther] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const reason = preset === "Other" ? other.trim() : (preset ?? "");
  const valid = reason.length >= 3;

  return (
    <form
      className="space-y-5 p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!valid || submitting) return;
        setSubmitting(true);
        try {
          await onConfirm(reason);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-xl font-bold">Why are you cancelling?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {CANCEL_REASONS.map((option) => (
            <label
              key={option}
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border-2 px-4 text-lg font-semibold",
                preset === option ? "border-staff-accent bg-brand-teal-soft" : "border-staff-line bg-staff-card",
              )}
            >
              <input
                type="radio"
                name="cancel-reason"
                value={option}
                checked={preset === option}
                onChange={() => setPreset(option)}
                className="size-6 accent-[var(--brand-teal-deep)]"
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      {preset === "Other" ? (
        <label className="block space-y-1.5">
          <span className="text-lg font-bold">Reason</span>
          <textarea
            value={other}
            onChange={(event) => setOther(event.target.value)}
            maxLength={300}
            rows={2}
            className="focus-ring w-full rounded-xl border-2 border-staff-line bg-staff-card p-3 text-lg"
            placeholder="A few words the customer will see"
            autoFocus
          />
        </label>
      ) : null}

      <p className="rounded-xl bg-staff-chip p-4 text-lg" data-testid="refund-statement" role="status">
        {refundableCents === null
          ? "Checking the payment…"
          : refundableCents > 0
            ? `This order was paid. Cancelling refunds ${formatCents(refundableCents)} to the customer's original payment method, and they get an email.`
            : "No payment is held for this order, so no refund will be issued. The customer gets an email."}
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onBack} className="focus-ring min-h-14 rounded-xl border-2 border-staff-line bg-staff-card text-lg font-bold">
          Keep order
        </button>
        <button
          type="submit"
          disabled={!valid || submitting || refundableCents === null}
          className="focus-ring min-h-14 rounded-xl bg-staff-fill-late px-4 text-lg font-extrabold text-white disabled:opacity-50"
        >
          {submitting
            ? "Cancelling…"
            : refundableCents
              ? `Cancel and refund ${formatCents(refundableCents)}`
              : `Cancel order ${order.orderNumber.slice(-4)}`}
        </button>
      </div>
    </form>
  );
}

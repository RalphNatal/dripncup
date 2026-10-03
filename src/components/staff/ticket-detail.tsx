"use client";

/**
 * A ticket opened up: the whole order, who did what and when, printing, and
 * Cancel. Cancelling asks for a reason from the presets (Other needs a few
 * words) and then says plainly whether the customer gets money back and how
 * much, before anything happens. It always goes through the server's
 * cancel-with-refund flow; the customer's tracker and the cancellation email
 * follow from the status change.
 */
import { useQuery } from "@tanstack/react-query";
import { Ban, Printer, Tags } from "lucide-react";
import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatCents } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { fetchOrderActivity, type OrderActivity } from "@/lib/staff/client";
import { isCancellable, type StaffOrder } from "@/lib/staff/queue";
import type { CatalogMeta } from "@/lib/staff/ticket";

import { OrderNumber, TicketItems } from "./ticket-card";

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

export function TicketDetail({
  order,
  meta,
  onClose,
  onPrint,
  onCancel,
}: {
  order: StaffOrder | null;
  meta: CatalogMeta;
  onClose: () => void;
  onPrint: (kind: "ticket" | "labels", order: StaffOrder) => void;
  /** Resolves true when the order was cancelled (or already was), so the dialog can close. */
  onCancel: (order: StaffOrder, reason: string, refundableCents: number) => Promise<boolean>;
}) {
  return (
    <Dialog open={order !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[92dvh] gap-0 overflow-y-auto p-0 sm:max-w-2xl [&_[data-slot=dialog-close]]:size-14 [&_[data-slot=dialog-close]_svg]:size-7">
        {order ? (
          <DetailBody key={order.id} order={order} meta={meta} onPrint={onPrint} onCancel={onCancel} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  order,
  meta,
  onPrint,
  onCancel,
  onClose,
}: {
  order: StaffOrder;
  meta: CatalogMeta;
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
    <div className="flex flex-col">
      <div className="space-y-1 border-b p-5 pr-20">
        <DialogTitle className="font-heading text-3xl leading-tight font-extrabold">
          {order.cupName ?? "No name"} · <OrderNumber value={order.orderNumber} />
        </DialogTitle>
        <DialogDescription className="text-lg text-foreground">
          <span className="font-bold" data-testid="detail-status">
            {ORDER_STATUS_LABELS[order.status]}
          </span>
          {" · "}
          {scheduled ? `Pickup ${formatCafeTimeOfDay(scheduled)}` : "ASAP"}
          {order.placedAt ? ` · Placed ${formatCafeTimeOfDay(new Date(order.placedAt))}` : ""}
        </DialogDescription>
      </div>

      {cancelling ? (
        <CancelForm
          order={order}
          refundableCents={activity.data?.refundableCents ?? null}
          onBack={() => setCancelling(false)}
          onConfirm={async (reason) => {
            const done = await onCancel(order, reason, activity.data?.refundableCents ?? 0);
            if (done) onClose();
          }}
        />
      ) : (
        <>
          <div className="space-y-5 p-5">
            {order.cancellationReason ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-lg">
                <span className="font-bold">Cancelled:</span> {order.cancellationReason}
              </p>
            ) : null}
            {order.notes ? (
              <p className="rounded-lg border-2 border-brand-magenta-deep bg-brand-pink-soft px-3 py-2 text-lg font-bold">
                Note: {order.notes}
              </p>
            ) : null}
            <TicketItems order={order} meta={meta} />

            <section aria-labelledby="history-heading">
              <h3 id="history-heading" className="mb-2 text-xl font-bold">
                History
              </h3>
              {activity.isPending ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : activity.isError ? (
                <p className="text-destructive">Couldn&apos;t load the history.</p>
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

          <div className="grid gap-2 border-t p-4 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => onPrint("ticket", order)}
              className="focus-ring inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 bg-card text-lg font-bold"
            >
              <Printer className="size-5" aria-hidden="true" /> Print ticket
            </button>
            <button
              type="button"
              onClick={() => onPrint("labels", order)}
              className="focus-ring inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 bg-card text-lg font-bold"
            >
              <Tags className="size-5" aria-hidden="true" /> Print cup labels
            </button>
            {isCancellable(order.status) ? (
              <button
                type="button"
                onClick={() => setCancelling(true)}
                className="focus-ring inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border-2 border-destructive bg-card text-lg font-bold text-destructive"
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
                preset === option ? "border-brand-teal-deep bg-brand-teal-soft" : "bg-card",
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
            className="focus-ring w-full rounded-xl border-2 bg-card p-3 text-lg"
            placeholder="A few words the customer will see"
            autoFocus
          />
        </label>
      ) : null}

      <p className="rounded-xl bg-muted p-4 text-lg" data-testid="refund-statement" role="status">
        {refundableCents === null
          ? "Checking the payment…"
          : refundableCents > 0
            ? `This order was paid. Cancelling refunds ${formatCents(refundableCents)} to the customer's original payment method, and they get an email.`
            : "No payment is held for this order, so no refund will be issued. The customer gets an email."}
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring min-h-14 rounded-xl border-2 bg-card text-lg font-bold"
        >
          Keep order
        </button>
        <button
          type="submit"
          disabled={!valid || submitting || refundableCents === null}
          className="focus-ring min-h-14 rounded-xl bg-destructive px-4 text-lg font-extrabold text-white disabled:opacity-50"
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

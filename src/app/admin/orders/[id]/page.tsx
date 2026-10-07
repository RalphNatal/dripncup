import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { ActionButton } from "@/components/admin/action-button";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RefundDialog } from "@/components/admin/refund-dialog";
import { StatusPill } from "@/components/admin/status-pill";
import { OrderBreakdown } from "@/components/checkout/order-breakdown";
import { dismissEmailAction, markRefundHandledAction, resolveFlaggedOrderAction, retryEmailAction, retryRefundAction } from "@/lib/admin/attention-actions";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { formatCents } from "@/lib/money";
import { ORDER_STATUS_LABEL, getAdminOrder } from "@/lib/orders/admin";
import { resendReceiptAction } from "@/lib/orders/admin-actions";
import { formatPoints } from "@/lib/rewards/model";
import { formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Order · Admin" };

type Params = Promise<{ id: string }>;

function Card({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-label={title} className="rounded-3xl border bg-card p-5" data-testid={testId}>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

const EMAIL_LABEL: Record<string, string> = {
  order_receipt: "Receipt",
  order_cancelled: "Cancellation",
  order_refunded: "Refund",
  order_ready: "Ready",
};

export default async function AdminOrderPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/orders/${id}`);
  if (!isUuid(id)) notFound();
  const detail = await getAdminOrder(id);
  if (!detail) notFound();
  const { order } = detail;
  const active = ["placed", "accepted", "preparing", "ready"].includes(order.status);
  const flagged = detail.review.flaggedAt && !detail.review.resolvedAt;
  const paid = Boolean(order.times.placed);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <AdminPageHeader
        backHref="/admin/orders"
        backLabel="Orders"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="font-mono">{order.orderNumber}</span>
            <StatusPill tone={active ? "good" : "neutral"} testId="order-status">
              {ORDER_STATUS_LABEL[order.status]}
            </StatusPill>
          </span>
        }
        description={`${order.location.name} · ${order.times.placed ? `placed ${formatCafeDateTime(new Date(order.times.placed))}` : `started ${formatCafeDateTime(new Date(order.createdAt))}`}${order.pickupType === "scheduled" && order.scheduledFor ? ` · pickup ${formatCafeDateTime(new Date(order.scheduledFor))}` : " · ASAP"}`}
        actions={
          <>
            {paid ? (
              <ActionButton action={resendReceiptAction.bind(null, id)} testId="resend-receipt">
                Resend receipt
              </ActionButton>
            ) : null}
            {active && detail.refundableCents > 0 ? <RefundDialog orderId={id} mode="cancel" refundableCents={detail.refundableCents} orderNumber={order.orderNumber} /> : null}
            {!active && paid && detail.refundableCents > 0 ? <RefundDialog orderId={id} mode="refund" refundableCents={detail.refundableCents} orderNumber={order.orderNumber} /> : null}
          </>
        }
      />

      {flagged ? (
        <div className="rounded-3xl border border-destructive/40 bg-destructive/5 p-5" role="alert">
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
            Needs review: {detail.review.reason}
          </p>
          <p className="mt-1 text-sm">The money was taken but the order wasn&apos;t placed. Accept the payment and place it, or cancel and refund it.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              variant="primary"
              action={resolveFlaggedOrderAction.bind(null, id, "place")}
              note={{ title: "Place this order?", description: "It goes to the counter's queue as it is; the customer gets a receipt.", label: "Why is this payment OK?", confirmLabel: "Place the order" }}
            >
              Place order
            </ActionButton>
            <ActionButton
              variant="danger"
              action={resolveFlaggedOrderAction.bind(null, id, "cancel")}
              note={{ title: "Cancel and refund?", description: "Everything that was paid is refunded; the customer is emailed.", label: "Reason", confirmLabel: "Cancel and refund", tone: "danger" }}
            >
              Refund and cancel
            </ActionButton>
          </div>
        </div>
      ) : detail.review.resolvedAt ? (
        <p className="rounded-2xl border p-4 text-sm">
          Payment review resolved {formatCafeDateTime(new Date(detail.review.resolvedAt))}: “{detail.review.note}”
        </p>
      ) : null}
      {order.cancellationReason ? <p className="rounded-2xl border p-4 text-sm">Cancelled: {order.cancellationReason}</p> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card title="Items" testId="order-items">
            <ul className="divide-y">
              {order.items.map((item) => (
                <li key={item.id} className="py-2">
                  <p className="flex justify-between gap-3 font-semibold">
                    <span>
                      {item.quantity} × {item.name}
                      {item.sizeName ? <span className="font-normal text-muted-foreground"> · {item.sizeName}</span> : null}
                    </span>
                    <span className="tabular">{formatCents(item.lineTotalCents)}</span>
                  </p>
                  {item.options.length ? <p className="text-sm text-muted-foreground">{item.options.join(", ")}</p> : null}
                  {item.specialInstructions ? <p className="text-sm">“{item.specialInstructions}”</p> : null}
                  {item.rewardNotes.map((n) => (
                    <p key={n} className="text-sm font-semibold text-brand-magenta-deep">
                      {n}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
            {detail.notes ? <p className="mt-2 text-sm">Note: {detail.notes}</p> : null}
            <div className="mt-3 border-t pt-3">
              <OrderBreakdown values={{ ...order.totals, rewards: order.rewards.map((r) => ({ label: r.label, discountCents: r.discountCents })) }} />
            </div>
          </Card>

          <Card title="Status history">
            <ol className="space-y-1 text-sm">
              {detail.history.map((h, i) => (
                <li key={i}>
                  <span className="font-semibold">{ORDER_STATUS_LABEL[h.to as keyof typeof ORDER_STATUS_LABEL] ?? h.to}</span> · {formatCafeDateTime(new Date(h.at))} ·{" "}
                  {h.by ? `${h.by}${h.role ? ` (${h.role})` : ""}` : "the system"}
                  {h.reason ? <span className="block text-muted-foreground">“{h.reason}”</span> : null}
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Emails" testId="order-emails">
            {detail.emails.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="divide-y text-sm">
                {detail.emails.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{EMAIL_LABEL[e.kind] ?? e.kind}</span> · {e.status === "sent" && e.sentAt ? `sent ${formatCafeDateTime(new Date(e.sentAt))}` : e.status}
                      {e.lastError && e.status !== "sent" ? <span className="block break-words text-destructive">{e.lastError}</span> : null}
                      {e.dismissedNote ? <span className="block text-muted-foreground">Dismissed: “{e.dismissedNote}”</span> : null}
                    </span>
                    {e.status === "failed" && !e.dismissedNote ? (
                      <>
                        <ActionButton size="sm" variant="primary" action={retryEmailAction.bind(null, e.id)}>
                          Retry
                        </ActionButton>
                        <ActionButton size="sm" action={dismissEmailAction.bind(null, e.id)} note={{ title: "Dismiss this email?", label: "Why not send it?", confirmLabel: "Dismiss" }}>
                          Dismiss
                        </ActionButton>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Customer">
            {detail.customer.anonymized ? (
              <p className="text-sm text-muted-foreground">Deleted account (details removed).</p>
            ) : (
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{detail.customer.name ?? "—"}</p>
                {order.cupName ? <p>Cup name: {order.cupName}</p> : null}
                {detail.customer.email ? <p className="break-all">{detail.customer.email}</p> : null}
                {detail.customer.phone ? <p>{detail.customer.phone}</p> : null}
                {detail.customer.id ? (
                  <Link href={`/admin/users/${detail.customer.id}`} className="inline-flex min-h-11 items-center font-semibold text-brand-teal-deep underline">
                    User details
                  </Link>
                ) : null}
              </div>
            )}
          </Card>

          <Card title="Payment" testId="order-payment">
            {detail.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payment.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {detail.payments.map((p, i) => (
                  <li key={i}>
                    <p className="font-semibold">
                      {formatCents(p.amountCents)} · {p.status.replace(/_/g, " ")}
                    </p>
                    {p.method ? <p className="text-muted-foreground">{p.method}</p> : null}
                    {p.refundedCents ? <p>Refunded {formatCents(p.refundedCents)}</p> : null}
                    {p.failure ? <p className="text-destructive">{p.failure}</p> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted-foreground">Left to refund: {formatCents(detail.refundableCents)}</p>
          </Card>

          <Card title="Refunds" testId="order-refunds">
            {detail.refunds.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {detail.refunds.map((r) => (
                  <li key={r.id}>
                    <p className="font-semibold">
                      {formatCents(r.amountCents)} · {r.status}
                    </p>
                    <p className="text-muted-foreground">
                      {formatCafeDateTime(new Date(r.createdAt))}
                      {r.by ? ` · ${r.by}` : ""} · “{r.reason}”
                    </p>
                    {r.failureReason ? <p className="break-words text-destructive">{r.failureReason}</p> : null}
                    {r.handledNote ? <p className="text-muted-foreground">Handled: “{r.handledNote}”</p> : null}
                    {r.status === "failed" && !r.handledNote ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <ActionButton size="sm" variant="primary" action={retryRefundAction.bind(null, r.id)}>
                          Retry
                        </ActionButton>
                        <ActionButton size="sm" action={markRefundHandledAction.bind(null, r.id)} note={{ title: "Mark handled?", label: "How was it handled?", confirmLabel: "Mark handled" }}>
                          Mark handled
                        </ActionButton>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Points">
            <p className="text-sm">
              Earns {formatPoints(order.points.toEarn)} at pickup{order.points.redeemed ? ` · spent ${formatPoints(order.points.redeemed)}` : ""}
            </p>
            {detail.points.length ? (
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {detail.points.map((p, i) => (
                  <li key={i}>
                    {p.type} {formatPoints(p.points, { signed: true })} · {formatCafeDateTime(new Date(p.at))}
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}

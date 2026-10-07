import { AlertTriangle, CalendarDays, Mail, Phone, Store, Truck, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { AdminCateringActions } from "@/components/catering/admin-actions";
import { QuoteBuilder } from "@/components/catering/quote-builder";
import { QuoteSummary } from "@/components/catering/quote-summary";
import { RequestTimeline } from "@/components/catering/request-timeline";
import { CateringStatusBadge } from "@/components/catering/status-badge";
import { requireRole } from "@/lib/auth/dal";
import { eventWhen } from "@/lib/catering/format";
import { getCateringRequest } from "@/lib/catering/queries";
import { initialDraftLines } from "@/lib/catering/quote-draft";
import { defaultQuoteExpiry, paymentDeadline } from "@/lib/catering/rules";
import { getCateringSettings } from "@/lib/catering/settings";
import { appNow } from "@/lib/clock";
import { listPickerProducts } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { refundableCents } from "@/lib/payments/refunds";
import { createClient } from "@/lib/supabase/server";
import { cafeDateKey, cafeTimeKey, formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Catering request · Admin" };

type Params = Promise<{ id: string }>;

const PAYMENT_LABELS: Record<string, string> = {
  requires_payment: "Started, not paid",
  processing: "Processing",
  succeeded: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
};

export default async function AdminCateringRequestPage({ params }: { params: Params }) {
  const { id } = await params;
  const profile = await requireRole(["admin"], `/admin/catering/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [request, settings, products, now] = await Promise.all([
    getCateringRequest(id, profile),
    getCateringSettings(),
    listPickerProducts(),
    appNow(),
  ]);
  if (!request) notFound();

  // Opening a request clears its "new" marker (not counted as a change to it).
  if (request.isNew) await (await createClient()).rpc("admin_catering_mark_seen", { p_request_id: id });

  const quote = request.currentQuote;
  // A revision starts from the latest version, even one sent back with a change request.
  const draftFrom = quote ?? request.quotes[0] ?? null;
  const canQuote = request.status === "submitted" || request.status === "quoted";
  const deadline = paymentDeadline(new Date(request.eventAt), settings.paymentDeadlineHours);
  const expiry = defaultQuoteExpiry(now, new Date(request.eventAt), settings);
  const refundable = request.status === "confirmed" ? await refundableCents({ kind: "catering", requestId: id }) : 0;
  const canFulfil = cafeDateKey(new Date(request.eventAt)) <= cafeDateKey(now);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <AdminPageHeader
        backHref="/admin/catering"
        backLabel="Catering"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="tabular">{request.requestNumber}</span>
            <CateringStatusBadge status={request.status} className="text-sm" />
          </span>
        }
        description={`Received ${formatCafeDateTime(new Date(request.createdAt))}${request.updatedByName ? ` · last changed by ${request.updatedByName}` : ""} (Honolulu time)`}
        actions={
          <AdminCateringActions
            requestId={request.id}
            status={request.status}
            refundableCents={refundable}
            canFulfil={canFulfil}
            cancellationRequestReason={request.cancellationRequestReason}
          />
        }
      />

      {request.flaggedForReviewAt ? (
        <p className="flex items-start gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            <strong>Needs review:</strong> {request.reviewReason}
          </span>
        </p>
      ) : null}
      {request.cancellationRequested && request.status === "confirmed" ? (
        <p className="flex items-start gap-2 rounded-2xl border border-warning/40 bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))] p-4 text-sm" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <strong>The customer asked to cancel</strong> on {formatCafeDateTime(new Date(request.cancellationRequestedAt!))}: “{request.cancellationRequestReason}”. Cancel with a refund
            (refund policy: {settings.refundPolicy}).
          </span>
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          {canQuote ? (
            expiry ? (
              <QuoteBuilder
                key={draftFrom?.id ?? "new"}
                requestId={request.id}
                isDelivery={request.fulfillment === "delivery"}
                products={products}
                initialLines={initialDraftLines(request, draftFrom, products)}
                initialDeliveryFeeCents={draftFrom?.deliveryFeeCents || settings.deliveryFeeCents}
                initialExpiry={{ date: cafeDateKey(expiry), time: cafeTimeKey(expiry) }}
                deadlineLabel={formatCafeDateTime(deadline)}
                minExpiryDate={cafeDateKey(now)}
                settings={{ taxRate: settings.taxRate, deliveryFeeTaxable: settings.deliveryFeeTaxable, gratuityTaxable: settings.gratuityTaxable }}
                revision={request.quotes.length > 0}
              />
            ) : (
              <p className="rounded-3xl border bg-card p-5 text-sm" role="status">
                The payment deadline ({settings.paymentDeadlineHours} hours before the event, {formatCafeDateTime(deadline)}) has passed, so a quote here could not be
                paid online. Contact the customer directly.
              </p>
            )
          ) : null}

          {request.quotes.length > 0 ? (
            <section className="space-y-4 rounded-3xl border bg-card p-5" aria-labelledby="admin-quotes">
              <h2 id="admin-quotes" className="text-lg font-bold">
                Quote versions
              </h2>
              <ol className="space-y-5">
                {request.quotes.map((q) => (
                  <li key={q.id} className="space-y-2" data-testid="quote-version">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold">Version {q.version}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold capitalize">{q.status}</span>
                      <span className="text-muted-foreground">
                        sent {formatCafeDateTime(new Date(q.createdAt))}
                        {q.createdByName ? ` by ${q.createdByName}` : ""} · expires {formatCafeDateTime(new Date(q.expiresAt))}
                      </span>
                    </p>
                    {q.supersededReason ? <p className="text-xs text-muted-foreground">{q.supersededReason}</p> : null}
                    {q.noteToCustomer ? <p className="rounded-xl bg-brand-pink-soft p-2 text-sm">{q.noteToCustomer}</p> : null}
                    <QuoteSummary quote={q} />
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="space-y-3 rounded-3xl border bg-card p-5" aria-labelledby="admin-history">
            <h2 id="admin-history" className="text-lg font-bold">
              Messages and history
            </h2>
            <RequestTimeline history={request.history} messages={request.messages} />
          </section>
        </div>

        <aside className="space-y-5">
          <section className="space-y-2 rounded-3xl border bg-card p-5 text-sm" aria-labelledby="admin-event">
            <h2 id="admin-event" className="text-lg font-bold">
              Event
            </h2>
            <p className="flex items-center gap-2">
              <CalendarDays className="size-4 text-brand-teal-deep" aria-hidden="true" />
              {eventWhen(request.eventAt)}
            </p>
            <p className="flex items-center gap-2">
              <Users className="size-4 text-brand-teal-deep" aria-hidden="true" />
              {request.headcount} guests
            </p>
            <p className="flex items-start gap-2">
              {request.fulfillment === "delivery" ? <Truck className="mt-0.5 size-4 text-brand-teal-deep" aria-hidden="true" /> : <Store className="mt-0.5 size-4 text-brand-teal-deep" aria-hidden="true" />}
              {request.fulfillment === "delivery"
                ? `Delivery to ${[request.deliveryAddress, request.deliveryPostalCode].filter(Boolean).join(", ")}`
                : `Pickup at ${request.locationName ?? "the cafe"}`}
            </p>
            <p className="text-muted-foreground">Prepared at {request.locationName ?? "the cafe"}</p>
          </section>

          <section className="space-y-2 rounded-3xl border bg-card p-5 text-sm" aria-labelledby="admin-contact">
            <h2 id="admin-contact" className="text-lg font-bold">
              Contact
            </h2>
            <p className="font-semibold">{request.contactName ?? "(account deleted)"}</p>
            {request.contactPhone ? (
              <a href={`tel:${request.contactPhone}`} className="focus-ring flex min-h-11 items-center gap-2 rounded font-semibold text-brand-teal-deep underline">
                <Phone className="size-4" aria-hidden="true" />
                {request.contactPhone}
              </a>
            ) : null}
            {request.contactEmail ? (
              <a href={`mailto:${request.contactEmail}`} className="focus-ring flex min-h-11 items-center gap-2 rounded font-semibold break-all text-brand-teal-deep underline">
                <Mail className="size-4 shrink-0" aria-hidden="true" />
                {request.contactEmail}
              </a>
            ) : null}
            {request.budgetCents !== null ? <p>Budget: {formatCents(request.budgetCents)}</p> : null}
          </section>

          <section className="space-y-2 rounded-3xl border bg-card p-5 text-sm" aria-labelledby="admin-asked">
            <h2 id="admin-asked" className="text-lg font-bold">
              Asked for
            </h2>
            <ul className="space-y-1">
              {request.items.map((item, index) => (
                <li key={index}>
                  <span className="tabular font-bold">{item.quantity}×</span> {item.name}
                  {item.sizeName ? <span className="text-muted-foreground"> ({item.sizeName})</span> : null}
                  {item.notes ? <span className="text-muted-foreground"> · {item.notes}</span> : null}
                </li>
              ))}
            </ul>
            {request.customDrinkRequest ? (
              <p className="rounded-xl bg-brand-pink-soft p-2">
                <strong>Signature drink:</strong> {request.customDrinkRequest}
              </p>
            ) : null}
            {request.notes ? (
              <p>
                <strong>Notes:</strong> {request.notes}
              </p>
            ) : null}
          </section>

          <section className="space-y-2 rounded-3xl border bg-card p-5 text-sm" aria-labelledby="admin-money">
            <h2 id="admin-money" className="text-lg font-bold">
              Payments and refunds
            </h2>
            {request.payments.length === 0 ? (
              <p className="text-muted-foreground">No payments yet.</p>
            ) : (
              <ul className="space-y-1" data-testid="admin-payments">
                {request.payments.map((p) => (
                  <li key={p.id}>
                    <span className="tabular font-semibold">{formatCents(p.amountCents)}</span> · {PAYMENT_LABELS[p.status] ?? p.status}
                    {p.refundedCents > 0 ? ` · ${formatCents(p.refundedCents)} refunded` : ""}
                    {p.method ? <span className="block text-xs text-muted-foreground">{p.method}</span> : null}
                  </li>
                ))}
              </ul>
            )}
            {request.refunds.length > 0 ? (
              <ul className="space-y-1 border-t pt-2" data-testid="admin-refunds">
                {request.refunds.map((r) => (
                  <li key={r.id}>
                    Refund <span className="tabular font-semibold">{formatCents(r.amountCents)}</span> · {r.status}
                    <span className="block text-xs text-muted-foreground">
                      {r.reason}
                      {r.failureReason ? ` · ${r.failureReason}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

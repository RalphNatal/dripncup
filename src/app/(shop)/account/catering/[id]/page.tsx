import { CalendarDays, Store, Truck, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CustomerCateringActions } from "@/components/catering/customer-actions";
import { QuoteSummary } from "@/components/catering/quote-summary";
import { RequestTimeline } from "@/components/catering/request-timeline";
import { CateringStatusBadge } from "@/components/catering/status-badge";
import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";
import { eventWhen } from "@/lib/catering/format";
import { getCateringRequest, type CateringRequestDetail } from "@/lib/catering/queries";
import { quotePayability } from "@/lib/catering/rules";
import { getCateringSettings } from "@/lib/catering/settings";
import { CATERING_STATUS_HINTS, cateringProgressIndex } from "@/lib/catering/status";
import { appNow } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { formatCafeDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Catering request" };

type Params = Promise<{ id: string }>;

const STEPS = ["Submitted", "Quote ready", "Confirmed", "Fulfilled"];

function Progress({ request }: { request: CateringRequestDetail }) {
  const current = cateringProgressIndex(request.status);
  if (current < 0) return null;
  return (
    <ol className="grid grid-cols-4 gap-1 text-center text-xs font-semibold" aria-label="Progress">
      {STEPS.map((step, index) => (
        <li key={step} aria-current={index === current ? "step" : undefined}>
          <span className={cn("mb-1 block h-1.5 rounded-full", index <= current ? "bg-brand-teal-deep" : "bg-muted")} aria-hidden="true" />
          <span className={index <= current ? "text-foreground" : "text-muted-foreground"}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** One request: where it stands, the quote, what was asked for, and the history. Owner only (RLS; 404 otherwise). */
export default async function CateringRequestPage({ params }: { params: Params }) {
  const { id } = await params;
  const profile = await requireProfile(`/account/catering/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [request, settings, now] = await Promise.all([getCateringRequest(id, profile), getCateringSettings(), appNow()]);
  if (!request || request.userId !== profile.id) notFound();

  const quote = request.currentQuote;
  const payable =
    request.status === "quoted" && quote
      ? (() => {
          const check = quotePayability({
            requestStatus: request.status,
            quote: { id: quote.id, status: quote.status, expiresAt: new Date(quote.expiresAt), paymentDeadlineAt: new Date(quote.paymentDeadlineAt) },
            currentQuoteId: quote.id,
            now,
          });
          return check.payable ? ({ ok: true } as const) : ({ ok: false, message: check.message } as const);
        })()
      : null;
  const earlier = request.quotes.filter((q) => q.id !== quote?.id);
  const paid = request.payments.filter((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status));
  const refunded = request.refunds.filter((r) => r.status === "succeeded" || r.status === "pending").reduce((sum, r) => sum + r.amountCents, 0);

  return (
    <PageShell title={`Catering ${request.requestNumber}`} backHref="/account/catering" backLabel="My catering">
      <div className="space-y-5">
        <section className="space-y-4 rounded-3xl border bg-card p-5" aria-labelledby="catering-status">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="catering-status" className="text-lg font-bold">
              {CATERING_STATUS_HINTS[request.status]}
            </h2>
            <CateringStatusBadge status={request.status} />
          </div>
          <Progress request={request} />
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-center gap-2">
              <CalendarDays className="size-4 text-brand-teal-deep" aria-hidden="true" />
              {eventWhen(request.eventAt)} (Honolulu time)
            </li>
            <li className="flex items-center gap-2">
              <Users className="size-4 text-brand-teal-deep" aria-hidden="true" />
              {request.headcount} guests
            </li>
            <li className="flex items-center gap-2">
              {request.fulfillment === "delivery" ? (
                <Truck className="size-4 text-brand-teal-deep" aria-hidden="true" />
              ) : (
                <Store className="size-4 text-brand-teal-deep" aria-hidden="true" />
              )}
              {request.fulfillment === "delivery"
                ? `Delivery to ${[request.deliveryAddress, request.deliveryPostalCode].filter(Boolean).join(", ")}`
                : `Pickup at ${request.locationName ?? "the cafe"}`}
            </li>
          </ul>
          {request.status === "cancelled" ? (
            <div className="rounded-2xl bg-muted p-3 text-sm">
              {request.cancellationReason ? <p>{request.cancellationReason}</p> : null}
              {paid.length > 0 ? (
                <p className="mt-1 font-semibold">
                  {refunded > 0 ? `Refunded ${formatCents(refunded)}.` : "No refund was issued for this payment; please contact us with any questions."}
                </p>
              ) : null}
            </div>
          ) : null}
          <CustomerCateringActions
            requestId={request.id}
            status={request.status}
            quoteId={quote?.id ?? null}
            payable={payable}
            cancellationRequested={request.cancellationRequested}
            refundPolicy={settings.refundPolicy}
          />
        </section>

        {quote && request.status !== "submitted" ? (
          <section className="space-y-3 rounded-3xl border bg-card p-5" aria-labelledby="catering-quote">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="catering-quote" className="text-lg font-bold">
                {quote.status === "paid" ? "Your receipt" : "Your quote"}
                {quote.version > 1 ? <span className="ml-2 text-sm font-normal text-muted-foreground">version {quote.version}</span> : null}
              </h2>
              {quote.status === "active" ? (
                <p className="text-sm text-muted-foreground">Pay by {formatCafeDateTime(new Date(Math.min(Date.parse(quote.expiresAt), Date.parse(quote.paymentDeadlineAt))))}</p>
              ) : null}
            </div>
            {quote.noteToCustomer ? <p className="rounded-2xl bg-brand-pink-soft p-3 text-sm">{quote.noteToCustomer}</p> : null}
            <QuoteSummary quote={quote} />
            {paid.find((p) => p.quoteId === quote.id)?.method ? (
              <p className="text-sm text-muted-foreground">Paid with {paid.find((p) => p.quoteId === quote.id)!.method}</p>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-3 rounded-3xl border bg-card p-5" aria-labelledby="catering-asked">
          <h2 id="catering-asked" className="text-lg font-bold">
            What you asked for
          </h2>
          {request.items.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {request.items.map((item, index) => (
                <li key={index}>
                  <span className="tabular font-bold">{item.quantity}×</span> {item.name}
                  {item.sizeName ? <span className="text-muted-foreground"> ({item.sizeName})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {request.customDrinkRequest ? (
            <p className="text-sm">
              <span className="font-semibold">Signature drink:</span> {request.customDrinkRequest}
            </p>
          ) : null}
          {request.notes ? (
            <p className="text-sm">
              <span className="font-semibold">Notes:</span> {request.notes}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {[request.contactName, request.contactPhone, request.contactEmail].filter(Boolean).join(" · ")}
            {request.budgetCents !== null ? ` · Budget ${formatCents(request.budgetCents)}` : ""}
          </p>
        </section>

        {earlier.length > 0 ? (
          <details className="rounded-3xl border bg-card p-5">
            <summary className="focus-ring cursor-pointer rounded font-bold">Earlier quotes ({earlier.length})</summary>
            <ul className="mt-3 space-y-4">
              {earlier.map((q) => (
                <li key={q.id}>
                  <p className="text-sm font-semibold">
                    Version {q.version} · {formatCents(q.totalCents)} · {q.supersededReason ?? q.status}
                  </p>
                  <QuoteSummary quote={q} className="mt-2 opacity-80" />
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <section className="space-y-3 rounded-3xl border bg-card p-5" aria-labelledby="catering-history">
          <h2 id="catering-history" className="text-lg font-bold">
            History
          </h2>
          <RequestTimeline history={request.history} messages={request.messages} />
        </section>
      </div>
    </PageShell>
  );
}

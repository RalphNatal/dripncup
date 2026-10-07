import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CateringPayView } from "@/components/catering/pay-view";
import { QuoteSummary } from "@/components/catering/quote-summary";
import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";
import { eventWhen } from "@/lib/catering/format";
import { getCateringRequest } from "@/lib/catering/queries";
import { quotePayability } from "@/lib/catering/rules";
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Pay for catering" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Accept & pay. The owner only (RLS, then an owner check; 404 for anyone
 * else); only the current quote, unexpired and before the payment deadline.
 * Also Stripe's return_url after a 3-D Secure challenge.
 */
export default async function CateringPayPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  const profile = await requireProfile(`/catering/${id}/pay`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [request, now] = await Promise.all([getCateringRequest(id, profile), appNow()]);
  if (!request || request.userId !== profile.id) notFound();
  const redirectStatus = (await searchParams).redirect_status;
  const back = (
    <Link href={`/account/catering/${id}`} className="focus-ring inline-flex min-h-11 items-center rounded-full border px-5 font-semibold hover:bg-muted">
      Back to your request
    </Link>
  );

  const quote = request.currentQuote;
  let blocked: string | null = null;
  if (request.status === "confirmed" || request.status === "fulfilled") blocked = "This request is already paid for. Mahalo!";
  else if (request.status !== "quoted" || !quote) blocked = "There's nothing to pay for this request right now.";
  else if (redirectStatus !== "succeeded") {
    const check = quotePayability({
      requestStatus: request.status,
      quote: { id: quote.id, status: quote.status, expiresAt: new Date(quote.expiresAt), paymentDeadlineAt: new Date(quote.paymentDeadlineAt) },
      currentQuoteId: quote.id,
      now,
    });
    if (!check.payable) blocked = check.message;
  }

  return (
    <PageShell title="Accept & pay" backHref={`/account/catering/${id}`} backLabel={`Catering ${request.requestNumber}`}>
      <div className="space-y-5">
        <section className="rounded-3xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">
            {request.requestNumber} · {eventWhen(request.eventAt)} · {request.headcount} guests
          </p>
          {quote ? <QuoteSummary quote={quote} className="mt-3" /> : null}
        </section>
        {blocked ? (
          <div className="space-y-4 text-center">
            <p className="rounded-2xl bg-muted p-4 text-sm font-medium" role="status" data-testid="catering-pay-blocked">
              {blocked}
            </p>
            {back}
          </div>
        ) : (
          <section className="rounded-3xl border bg-card p-5">
            <CateringPayView
              requestId={request.id}
              quoteId={quote!.id}
              totalCents={quote!.totalCents}
              publishableKey={clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
              returning={redirectStatus === "succeeded" || redirectStatus === "processing"}
            />
          </section>
        )}
      </div>
    </PageShell>
  );
}

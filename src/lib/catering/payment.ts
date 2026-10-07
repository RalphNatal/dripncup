import "server-only";

/**
 * Paying for a catering quote: the same Payment Element and PaymentIntent
 * pattern as checkout (not a hosted Payment Link), so it stays on-brand and
 * shares the webhook, its dedupe and amount check, the reconcile fallback
 * and the refund machinery. PaymentIntents carry `type=catering` with the
 * request and quote ids, which is how the webhook routes them.
 *
 * One PaymentIntent per quote version (idempotency key = the quote id), so
 * reopening the pay page, a double tap or a retry after a decline all pay
 * the same intent. The amount is always the quote's stored total.
 */
import { paymentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

export type StartPaymentResult =
  | { ok: true; clientSecret: string; totalCents: number; paymentIntentId: string }
  | { ok: false; message: string; alreadyPaying?: boolean };

/**
 * The PaymentIntent for a quote the caller has already been allowed to pay
 * (catering_payable_quote passed for them): reused if one is open, created
 * otherwise.
 */
export async function paymentIntentForQuote(quote: {
  requestId: string;
  requestNumber: string;
  quoteId: string;
  version: number;
  totalCents: number;
  contactEmail: string | null;
}): Promise<StartPaymentResult> {
  const db = createAdminClient();
  const provider = paymentProvider();

  const { data: existing } = await db
    .from("payments")
    .select("provider_payment_intent_id, status, created_at")
    .eq("catering_quote_id", quote.quoteId)
    .order("created_at", { ascending: false });

  for (const row of existing ?? []) {
    if (!row.provider_payment_intent_id || row.status === "cancelled") continue;
    const current = await provider.retrievePayment(row.provider_payment_intent_id);
    if (current.status === "succeeded" || current.status === "processing") {
      return { ok: false, alreadyPaying: true, message: "Your payment is already going through." };
    }
    if (current.status !== "canceled" && current.amountCents === quote.totalCents) {
      return { ok: true, clientSecret: current.clientSecret, totalCents: quote.totalCents, paymentIntentId: current.id };
    }
  }

  // A fresh key per attempt after a cancelled one (Stripe would otherwise
  // hand back the cancelled intent for 24 hours).
  const attempt = (existing ?? []).length + 1;
  const payment = await provider.createPayment({
    subject: {
      kind: "catering",
      requestId: quote.requestId,
      requestNumber: quote.requestNumber,
      quoteId: quote.quoteId,
      quoteVersion: quote.version,
    },
    amountCents: quote.totalCents,
    currency: "usd",
    idempotencyKey: `${quote.quoteId}-${attempt}`,
    customerEmail: quote.contactEmail,
    description: `Drincup Cafe catering ${quote.requestNumber} (quote v${quote.version})`,
  });

  const { error } = await db.from("payments").upsert(
    {
      catering_request_id: quote.requestId,
      catering_quote_id: quote.quoteId,
      provider: provider.name,
      provider_payment_intent_id: payment.id,
      status: "requires_payment",
      amount_cents: quote.totalCents,
      tip_cents: 0,
    },
    { onConflict: "provider_payment_intent_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not record the catering payment for ${quote.requestNumber}: ${error.message}`);

  return { ok: true, clientSecret: payment.clientSecret, totalCents: quote.totalCents, paymentIntentId: payment.id };
}

/**
 * Stops unpaid PaymentIntents for a request from being completed (its quote
 * was sent back, revised or the request cancelled). Best effort: anything
 * that slips through is refunded by the webhook ("not_payable").
 */
export async function cancelOpenCateringPayments(requestId: string, exceptQuoteId?: string | null): Promise<void> {
  const db = createAdminClient();
  const { data } = await db
    .from("payments")
    .select("provider_payment_intent_id, catering_quote_id")
    .eq("catering_request_id", requestId)
    .in("status", ["requires_payment", "failed"]);
  for (const row of data ?? []) {
    if (!row.provider_payment_intent_id || (exceptQuoteId && row.catering_quote_id === exceptQuoteId)) continue;
    try {
      const status = await paymentProvider().cancelPayment(row.provider_payment_intent_id);
      if (status === "canceled") {
        await db.from("payments").update({ status: "cancelled" }).eq("provider_payment_intent_id", row.provider_payment_intent_id);
      }
    } catch (error) {
      console.warn(`Could not cancel catering payment ${row.provider_payment_intent_id}`, error);
    }
  }
}

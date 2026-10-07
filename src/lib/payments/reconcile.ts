import "server-only";

/**
 * The reconcile fallback.
 *
 * The webhook is how a payment normally lands. If it is late or lost (the
 * listener is down, a deploy swallowed it), a customer would sit on
 * "Confirming your payment…" for good. So the pages that wait for it (the
 * order confirmation page, the catering payment page) ask the server to
 * reconcile after a few seconds: the server reads the PaymentIntent from
 * the provider's API with the secret key -- never trusting the browser or
 * the redirect -- and, if it has succeeded, runs exactly the handler the
 * webhook runs. Every step of that handler is idempotent and row-locked, so
 * the webhook arriving later (or at the same moment) changes nothing twice.
 *
 * Throttled per payment, so a page left open cannot hammer the provider.
 */
import { kickOutbox } from "@/lib/email/outbox";
import { hit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

import { paymentProvider } from "./index";
import { applyPaymentSucceeded } from "./webhook";

/** At most one provider read per payment per this many seconds. */
const RECONCILE_LIMIT = { scope: "reconcile:payment", max: 1, windowSeconds: 8 } as const;

export type ReconcileOutcome = "applied" | "not_paid" | "throttled" | "no_payment";

/** Reads one PaymentIntent; if it has succeeded, applies it as the webhook would. */
export async function reconcilePayment(paymentIntentId: string): Promise<ReconcileOutcome> {
  if (!(await hit(RECONCILE_LIMIT, paymentIntentId))) return "throttled";

  const provider = paymentProvider();
  const payment = await provider.retrievePayment(paymentIntentId);
  if (payment.status !== "succeeded") return "not_paid";

  await applyPaymentSucceeded({
    // Not a provider event: nothing is written to webhook_events for it.
    id: `reconcile:${payment.id}`,
    type: "payment.succeeded",
    paymentId: payment.id,
    target: payment.target,
    amountCents: payment.amountCents,
    currency: payment.currency,
    chargeId: payment.chargeId,
    method: await provider.paymentMethodOf(payment.chargeId),
  });
  // Receipts and confirmations owed by the change go out after the response.
  kickOutbox();
  return "applied";
}

/** The latest payment of the customer's own unpaid order, reconciled. */
export async function reconcileOrderPayment(orderId: string, userId: string): Promise<ReconcileOutcome> {
  const { data: order } = await createAdminClient()
    .from("orders")
    .select("id, user_id, status, payments(provider_payment_intent_id, created_at)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.user_id !== userId || order.status !== "pending_payment") return "no_payment";
  const latest = [...(order.payments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return latest?.provider_payment_intent_id ? reconcilePayment(latest.provider_payment_intent_id) : "no_payment";
}

/** The latest payment for the customer's own catering request that is still waiting to be confirmed. */
export async function reconcileCateringPayment(requestId: string, userId: string): Promise<ReconcileOutcome> {
  const { data: request } = await createAdminClient()
    .from("catering_requests")
    .select("id, user_id, status, payments(provider_payment_intent_id, status, created_at)")
    .eq("id", requestId)
    .maybeSingle();
  if (!request || request.user_id !== userId || request.status !== "quoted") return "no_payment";
  const latest = [...(request.payments ?? [])]
    .filter((p) => p.status !== "cancelled")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return latest?.provider_payment_intent_id ? reconcilePayment(latest.provider_payment_intent_id) : "no_payment";
}

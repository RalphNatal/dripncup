import "server-only";

/**
 * Cancels checkouts nobody paid for.
 *
 * An order sits in `pending_payment` from the moment the customer presses
 * Pay until the webhook confirms the money. Past the configured age (default
 * 30 minutes) it is abandoned: its PaymentIntent is cancelled first -- so it
 * can never be completed later -- and then the order. If the provider says
 * the payment has already succeeded or is still processing, the order is left
 * for the webhook. Orders flagged for review (amount mismatch) are never
 * touched here.
 *
 * Cancelling the order also returns any reward points its checkout was
 * holding (the database's loyalty trigger does that).
 */
import { getCheckoutSettings } from "@/lib/checkout/settings";
import { paymentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

export interface ExpiryReport {
  cutoff: string;
  expired: string[];
  /** Left alone because the provider says money is on its way. */
  skipped: string[];
  failed: { orderId: string; error: string }[];
}

export const EXPIRED_REASON = "Checkout expired before the payment was completed.";

export type CancelUnpaidOutcome = "cancelled" | "money_on_its_way" | "not_pending";

/**
 * Cancels one unpaid checkout: its PaymentIntents first, then the order. A
 * payment the provider reports as succeeded or processing leaves the order
 * alone for the webhook.
 */
export async function cancelUnpaidCheckout(orderId: string, reason: string): Promise<CancelUnpaidOutcome> {
  const db = createAdminClient();
  const { data: order, error } = await db
    .from("orders")
    .select("id, status, payments(provider_payment_intent_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`Could not read order ${orderId}: ${error.message}`);
  if (!order || order.status !== "pending_payment") return "not_pending";

  let moneyOnItsWay = false;
  for (const payment of order.payments ?? []) {
    if (!payment.provider_payment_intent_id) continue;
    const status = await paymentProvider().cancelPayment(payment.provider_payment_intent_id);
    if (status === "succeeded" || status === "processing") moneyOnItsWay = true;
  }
  if (moneyOnItsWay) return "money_on_its_way";

  await db
    .from("payments")
    .update({ status: "cancelled" })
    .eq("order_id", orderId)
    .in("status", ["requires_payment", "processing", "failed"]);
  const { data: cancelled, error: cancelError } = await db
    .from("orders")
    .update({ status: "cancelled", cancellation_reason: reason })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("id");
  if (cancelError) throw new Error(cancelError.message);
  return cancelled?.length ? "cancelled" : "not_pending";
}

export async function expirePendingOrders(now: Date = new Date(), limit = 100): Promise<ExpiryReport> {
  const db = createAdminClient();
  const { pendingExpiryMinutes } = await getCheckoutSettings();
  const cutoff = new Date(now.getTime() - pendingExpiryMinutes * 60_000).toISOString();

  const { data: stale, error } = await db
    .from("orders")
    .select("id")
    .eq("status", "pending_payment")
    .is("flagged_for_review_at", null)
    .lt("created_at", cutoff)
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(`Expiry: could not list pending orders (${error.message})`);

  const report: ExpiryReport = { cutoff, expired: [], skipped: [], failed: [] };

  for (const order of stale ?? []) {
    try {
      const outcome = await cancelUnpaidCheckout(order.id, EXPIRED_REASON);
      if (outcome === "cancelled") report.expired.push(order.id);
      else if (outcome === "money_on_its_way") report.skipped.push(order.id);
    } catch (err) {
      report.failed.push({ orderId: order.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return report;
}

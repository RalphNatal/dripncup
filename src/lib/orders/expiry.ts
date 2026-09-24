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

export async function expirePendingOrders(now: Date = new Date(), limit = 100): Promise<ExpiryReport> {
  const db = createAdminClient();
  const { pendingExpiryMinutes } = await getCheckoutSettings();
  const cutoff = new Date(now.getTime() - pendingExpiryMinutes * 60_000).toISOString();

  const { data: stale, error } = await db
    .from("orders")
    .select("id, payments(provider_payment_intent_id, status)")
    .eq("status", "pending_payment")
    .is("flagged_for_review_at", null)
    .lt("created_at", cutoff)
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(`Expiry: could not list pending orders (${error.message})`);

  const report: ExpiryReport = { cutoff, expired: [], skipped: [], failed: [] };

  for (const order of stale ?? []) {
    try {
      const paymentIds = (order.payments ?? [])
        .map((p) => p.provider_payment_intent_id)
        .filter((id): id is string => Boolean(id));

      let moneyOnItsWay = false;
      for (const paymentId of paymentIds) {
        const status = await paymentProvider().cancelPayment(paymentId);
        if (status === "succeeded" || status === "processing") moneyOnItsWay = true;
      }
      if (moneyOnItsWay) {
        report.skipped.push(order.id);
        continue;
      }

      await db
        .from("payments")
        .update({ status: "cancelled" })
        .eq("order_id", order.id)
        .in("status", ["requires_payment", "processing", "failed"]);
      const { error: cancelError } = await db
        .from("orders")
        .update({ status: "cancelled", cancellation_reason: EXPIRED_REASON })
        .eq("id", order.id)
        .eq("status", "pending_payment");
      if (cancelError) throw new Error(cancelError.message);

      report.expired.push(order.id);
    } catch (err) {
      report.failed.push({ orderId: order.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return report;
}

import "server-only";

/**
 * Money first, then the account (carried forward from Phase 2).
 *
 * Before delete_account_data() cancels a customer's unfinished orders and
 * catering requests, every one that was paid is refunded in full, and every
 * payment still waiting (a checkout, a catering quote) has its PaymentIntent
 * cancelled so it cannot be completed afterwards. A
 * refund that fails does not block the deletion: it stays in `refunds` as
 * `failed` for an admin to retry.
 */
import { paymentProvider } from "@/lib/payments";
import { cancelOpenCateringPayments } from "@/lib/catering/payment";
import { refundOrder, refundPayment } from "@/lib/payments/refunds";
import { createAdminClient } from "@/lib/supabase/admin";

export const ACCOUNT_CLOSED_REFUND_REASON = "Customer closed their account";

export interface DeletionRefundReport {
  refunded: string[];
  failed: string[];
  paymentsCancelled: string[];
}

export async function settleOrdersBeforeAccountDeletion(userId: string): Promise<DeletionRefundReport> {
  const db = createAdminClient();
  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, payments(provider_payment_intent_id, status)")
    .eq("user_id", userId)
    .in("status", ["pending_payment", "placed", "accepted", "preparing", "ready"]);
  if (error) throw new Error(`Could not list orders before account deletion: ${error.message}`);

  const report: DeletionRefundReport = { refunded: [], failed: [], paymentsCancelled: [] };

  for (const order of orders ?? []) {
    if (order.status === "pending_payment") {
      for (const payment of order.payments ?? []) {
        if (!payment.provider_payment_intent_id) continue;
        try {
          // If it had in fact just succeeded, the webhook will find the
          // order cancelled by the deletion and refund it then.
          await paymentProvider().cancelPayment(payment.provider_payment_intent_id);
          report.paymentsCancelled.push(order.id);
        } catch (err) {
          console.error(`Account deletion: could not cancel payment for order ${order.id}`, err);
        }
      }
      continue;
    }

    const outcome = await refundOrder({ orderId: order.id, reason: ACCOUNT_CLOSED_REFUND_REASON, requestedBy: userId });
    if (outcome.ok) report.refunded.push(order.id);
    else if (outcome.reason === "failed") report.failed.push(order.id);
  }

  // Catering: a paid (confirmed) request is refunded in full; an unpaid
  // quote's PaymentIntent is cancelled. The requests themselves are
  // cancelled and anonymised by delete_account_data.
  const { data: catering, error: cateringError } = await db
    .from("catering_requests")
    .select("id, status")
    .eq("user_id", userId)
    .in("status", ["submitted", "quoted", "confirmed"]);
  if (cateringError) throw new Error(`Could not list catering requests before account deletion: ${cateringError.message}`);
  for (const request of catering ?? []) {
    await cancelOpenCateringPayments(request.id);
    if (request.status !== "confirmed") continue;
    const outcome = await refundPayment({
      subject: { kind: "catering", requestId: request.id },
      reason: ACCOUNT_CLOSED_REFUND_REASON,
      requestedBy: userId,
    });
    if (outcome.ok) report.refunded.push(request.id);
    else if (outcome.reason === "failed") report.failed.push(request.id);
  }

  return report;
}

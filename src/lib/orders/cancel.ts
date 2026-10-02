import "server-only";

/**
 * Cancel a paid order and give the money back -- for the staff queue and
 * admin (Phase 6 wires this to buttons). The only way to cancel an order that
 * holds money: advance_order_status() refuses those.
 *
 * Authorisation is checked here and again in cancel_order_for_refund(), not
 * only in whatever page calls it: the actor must be an admin, or staff
 * rostered to the order's location.
 */
import { refundOrder, type RefundOutcome } from "@/lib/payments/refunds";
import { createAdminClient } from "@/lib/supabase/admin";

export type CancelResult =
  | { ok: true; refund: RefundOutcome }
  | { ok: false; code: "not_found" | "forbidden" | "not_cancellable" | "reason_required"; message: string };

export async function cancelOrderWithRefund({
  orderId,
  reason,
  actorId,
}: {
  orderId: string;
  reason: string;
  actorId: string;
}): Promise<CancelResult> {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    return { ok: false, code: "reason_required", message: "Give a reason for cancelling." };
  }

  // The actor, their roster and the order's state are checked inside
  // cancel_order_for_refund under the order's row lock, and the staff member
  // is recorded in the status history.
  const db = createAdminClient();
  const { data: outcome, error } = await db.rpc("cancel_order_for_refund", {
    p_order_id: orderId,
    p_reason: trimmed,
    p_actor_id: actorId,
  });
  if (error) throw new Error(`Could not cancel order ${orderId}: ${error.message}`);

  switch (outcome) {
    case "cancelled":
      break;
    case "not_found":
      return { ok: false, code: "not_found", message: "Order not found." };
    case "forbidden":
      return { ok: false, code: "forbidden", message: "Only staff rostered to this location can cancel its orders." };
    case "reason_required":
      return { ok: false, code: "reason_required", message: "Give a reason for cancelling." };
    default:
      return { ok: false, code: "not_cancellable", message: "This order can no longer be cancelled." };
  }

  // Cancelled first, then refunded: if the refund fails the order is still
  // off the queue and the failed refund row is waiting for an admin.
  const refund = await refundOrder({ orderId, reason: trimmed, requestedBy: actorId });
  return { ok: true, refund };
}

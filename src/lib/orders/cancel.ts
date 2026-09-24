import "server-only";

/**
 * Cancel an order and give the money back -- for the staff queue and admin
 * (Phase 6 wires this to buttons).
 *
 * Authorisation is checked here, not only in whatever page calls it: the
 * actor must be an admin, or staff rostered to the order's location.
 */
import { refundOrder, type RefundOutcome } from "@/lib/payments/refunds";
import { createAdminClient } from "@/lib/supabase/admin";

/** States an order can still be cancelled from (before pickup). */
const CANCELLABLE = ["placed", "accepted", "preparing", "ready"] as const;

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

  const db = createAdminClient();
  const [{ data: order }, { data: actor }] = await Promise.all([
    db.from("orders").select("id, status, location_id").eq("id", orderId).maybeSingle(),
    db.from("profiles").select("id, role, deleted_at").eq("id", actorId).maybeSingle(),
  ]);
  if (!order) return { ok: false, code: "not_found", message: "Order not found." };
  if (!actor || actor.deleted_at || actor.role === "customer") {
    return { ok: false, code: "forbidden", message: "Only staff can cancel orders." };
  }
  if (actor.role === "staff") {
    const { data: roster } = await db
      .from("staff_locations")
      .select("profile_id")
      .eq("profile_id", actorId)
      .eq("location_id", order.location_id)
      .maybeSingle();
    if (!roster) return { ok: false, code: "forbidden", message: "You're not rostered to this location." };
  }

  if (!(CANCELLABLE as readonly string[]).includes(order.status)) {
    return { ok: false, code: "not_cancellable", message: `An order that is ${order.status} can't be cancelled.` };
  }

  const { error } = await db
    .from("orders")
    .update({ status: "cancelled", cancellation_reason: trimmed })
    .eq("id", orderId)
    .in("status", [...CANCELLABLE]);
  if (error) throw new Error(`Could not cancel order ${orderId}: ${error.message}`);

  // Cancelled first, then refunded: if the refund fails the order is still
  // off the queue and the failed refund row is waiting for an admin.
  const refund = await refundOrder({ orderId, reason: trimmed, requestedBy: actorId });
  return { ok: true, refund };
}

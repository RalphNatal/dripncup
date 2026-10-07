"use server";

/**
 * Resolving attention-queue items. Each checks the caller is an admin; the
 * database functions check again and record who resolved what, with the
 * note, in the audit log.
 */
import { revalidatePath } from "next/cache";

import { kickOutbox } from "@/lib/email/outbox";
import { cancelUnpaidCheckout, EXPIRED_REASON } from "@/lib/orders/expiry";
import { reconcilePayment } from "@/lib/payments/reconcile";
import { refundOrder, retryRefund } from "@/lib/payments/refunds";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { currentAdmin, isUuid, NOT_ADMIN, noteOrNull, rpcFailure, type ActionResult } from "./guard";

const NEED_NOTE: ActionResult = { ok: false, message: "Add a short note (3 characters or more)." };

function refresh(orderId?: string | null, requestId?: string | null) {
  revalidatePath("/admin", "layout");
  if (orderId) revalidatePath(`/admin/orders/${orderId}`);
  if (requestId) revalidatePath(`/admin/catering/${requestId}`);
}

export async function retryEmailAction(emailId: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(emailId)) return { ok: false, message: "Email not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_retry_email", { p_email_id: emailId });
  if (error) return rpcFailure(error, "Couldn't retry that email.");
  kickOutbox();
  refresh();
  return { ok: true, message: "Sending it again now." };
}

export async function dismissEmailAction(emailId: unknown, note: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  const text = noteOrNull(note);
  if (!isUuid(emailId)) return { ok: false, message: "Email not found." };
  if (!text) return NEED_NOTE;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_dismiss_email", { p_email_id: emailId, p_note: text });
  if (error) return rpcFailure(error, "Couldn't dismiss that email.");
  refresh();
  return { ok: true, message: "Dismissed." };
}

export async function retryRefundAction(refundId: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(refundId)) return { ok: false, message: "Refund not found." };
  const { data: row } = await createAdminClient()
    .from("refunds")
    .select("order_id, catering_request_id, status, handled_at")
    .eq("id", refundId)
    .maybeSingle();
  if (!row || row.status !== "failed" || row.handled_at) return { ok: false, message: "This refund isn't waiting to be retried." };
  const outcome = await retryRefund(refundId);
  refresh(row.order_id, row.catering_request_id);
  if (!outcome.ok) {
    return { ok: false, message: outcome.reason === "failed" ? `The refund failed again: ${outcome.message}` : "There's nothing left to refund." };
  }
  kickOutbox();
  return { ok: true, message: outcome.status === "succeeded" ? "Refunded." : "Refund sent; the payment provider is finishing it." };
}

export async function markRefundHandledAction(refundId: unknown, note: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  const text = noteOrNull(note);
  if (!isUuid(refundId)) return { ok: false, message: "Refund not found." };
  if (!text) return NEED_NOTE;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_mark_refund_handled", { p_refund_id: refundId, p_note: text });
  if (error) return rpcFailure(error, "Couldn't mark that refund handled.");
  refresh();
  return { ok: true, message: "Marked handled." };
}

/**
 * A payment that did not match its order. "place": accept the payment and
 * send the order to the counter. "cancel": cancel and refund it in full.
 */
export async function resolveFlaggedOrderAction(orderId: unknown, resolution: unknown, note: unknown): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_ADMIN;
  const text = noteOrNull(note);
  if (!isUuid(orderId) || (resolution !== "place" && resolution !== "cancel")) return { ok: false, message: "Order not found." };
  if (!text) return NEED_NOTE;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_resolve_flagged_order", { p_order_id: orderId, p_resolution: resolution, p_note: text });
  if (error) return rpcFailure(error, "Couldn't resolve that order.");

  if (resolution === "cancel") {
    const refund = await refundOrder({ orderId, reason: `Payment didn't match the order: ${text}`, requestedBy: admin.id });
    kickOutbox();
    refresh(orderId);
    if (!refund.ok && refund.reason === "failed") {
      return { ok: false, message: "Cancelled, but the refund failed. It's in Needs attention to retry." };
    }
    return { ok: true, message: "Cancelled and refunded." };
  }
  kickOutbox();
  refresh(orderId);
  return { ok: true, message: "Placed. It's on the counter's queue now." };
}

export async function clearCateringFlagAction(requestId: unknown, note: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  const text = noteOrNull(note);
  if (!isUuid(requestId)) return { ok: false, message: "Request not found." };
  if (!text) return NEED_NOTE;
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_clear_catering_flag", { p_request_id: requestId, p_note: text });
  if (error) return rpcFailure(error, "Couldn't mark that reviewed.");
  refresh(null, requestId);
  return { ok: true, message: "Marked reviewed." };
}

/**
 * An unpaid order stuck past its expiry: ask the payment provider. Paid ->
 * placed exactly as the webhook would; not paid -> cancelled as the expiry
 * job would; still processing -> left, with a note.
 */
export async function checkStuckOrderAction(orderId: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(orderId)) return { ok: false, message: "Order not found." };
  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, status, flagged_for_review_at, payments(provider_payment_intent_id, created_at)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.status !== "pending_payment") {
    refresh(orderId);
    return { ok: true, message: "This order is no longer waiting for payment." };
  }
  if (order.flagged_for_review_at) return { ok: false, message: "This order is flagged; resolve the payment mismatch instead." };

  const latest = [...(order.payments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (latest?.provider_payment_intent_id) {
    const outcome = await reconcilePayment(latest.provider_payment_intent_id);
    if (outcome === "applied") {
      refresh(orderId);
      return { ok: true, message: "The payment had gone through. The order is placed." };
    }
    if (outcome === "throttled") return { ok: false, message: "Checked a moment ago. Try again in a few seconds." };
  }
  const result = await cancelUnpaidCheckout(orderId, EXPIRED_REASON);
  if (result === "money_on_its_way") {
    await db.from("orders").update({ expiry_attempted_at: new Date().toISOString(), expiry_note: "The payment provider says the payment is still processing." }).eq("id", orderId);
    refresh(orderId);
    return { ok: false, message: "The payment provider says the payment is still processing. Check again later." };
  }
  refresh(orderId);
  return { ok: true, message: result === "cancelled" ? "Not paid, so the checkout was cancelled." : "This order is no longer waiting for payment." };
}

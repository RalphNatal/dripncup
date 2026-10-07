"use server";

/**
 * Admin order actions, reusing the existing money paths:
 *
 *   cancel with refund   an order not yet picked up: cancel_order_for_refund
 *                        (admin recorded in the status history), then a full
 *                        or partial refund through refundOrder
 *   refund               a picked-up (or already cancelled) order: part or all
 *                        of what is left; refunding it all marks it Refunded
 *   resend receipt       a fresh receipt email to the customer
 *
 * Totals and items never change after payment; nothing here edits them.
 */
import { revalidatePath } from "next/cache";

import { currentAdmin, isUuid, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { kickOutbox } from "@/lib/email/outbox";
import { formatCents } from "@/lib/money";
import { refundableCents, refundOrder } from "@/lib/payments/refunds";
import { createClient } from "@/lib/supabase/server";

import { cancelOrderWithRefund } from "./cancel";

function amountFrom(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim().replace(/^\$/, "");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(text)) return "invalid";
  const cents = Math.round(Number(text) * 100);
  return cents > 0 ? cents : "invalid";
}

function refresh(orderId: string) {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin", "layout");
}

/** amount: dollars as text, or empty for everything that is left. */
export async function cancelWithRefundAction(orderId: unknown, amount: unknown, reason: unknown): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_ADMIN;
  if (!isUuid(orderId)) return { ok: false, message: "Order not found." };
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 3) return { ok: false, message: "Give a reason (3 characters or more).", fieldErrors: { reason: "Required." } };
  const cents = amountFrom(amount);
  if (cents === "invalid") return { ok: false, message: "Enter an amount like 4.50, or leave it empty for a full refund.", fieldErrors: { amount: "Like 4.50." } };
  const left = await refundableCents({ kind: "order", orderId });
  if (cents !== null && cents > left) return { ok: false, message: `At most ${formatCents(left)} can be refunded.`, fieldErrors: { amount: `Up to ${formatCents(left)}.` } };

  const result = await cancelOrderWithRefund({ orderId, reason: why, actorId: admin.id, amountCents: cents ?? undefined });
  kickOutbox();
  refresh(orderId);
  if (!result.ok) return { ok: false, message: result.message };
  if (!result.refund.ok) {
    return result.refund.reason === "failed"
      ? { ok: false, message: "Cancelled, but the refund failed. It's in Needs attention to retry." }
      : { ok: true, message: "Cancelled. There was no payment to refund." };
  }
  return { ok: true, message: `Cancelled and refunded ${formatCents(result.refund.amountCents)}.` };
}

export async function refundAction(orderId: unknown, amount: unknown, reason: unknown): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_ADMIN;
  if (!isUuid(orderId)) return { ok: false, message: "Order not found." };
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 3) return { ok: false, message: "Give a reason (3 characters or more).", fieldErrors: { reason: "Required." } };
  const cents = amountFrom(amount);
  if (cents === "invalid") return { ok: false, message: "Enter an amount like 4.50, or leave it empty for a full refund.", fieldErrors: { amount: "Like 4.50." } };

  const supabase = await createClient();
  const { data: order } = await supabase.from("orders").select("status").eq("id", orderId).maybeSingle();
  if (!order || !["picked_up", "cancelled"].includes(order.status)) {
    return { ok: false, message: "Refund an order in progress by cancelling it with a refund." };
  }
  const left = await refundableCents({ kind: "order", orderId });
  if (left <= 0) return { ok: false, message: "Nothing is left to refund." };
  if (cents !== null && cents > left) return { ok: false, message: `At most ${formatCents(left)} can be refunded.`, fieldErrors: { amount: `Up to ${formatCents(left)}.` } };

  const refund = await refundOrder({ orderId, reason: why, requestedBy: admin.id, amountCents: cents ?? undefined });
  kickOutbox();
  refresh(orderId);
  if (!refund.ok) return { ok: false, message: refund.reason === "failed" ? "The refund failed. It's in Needs attention to retry." : "Nothing is left to refund." };
  return { ok: true, message: `Refunded ${formatCents(refund.amountCents)}.` };
}

export async function resendReceiptAction(orderId: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(orderId)) return { ok: false, message: "Order not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_resend_receipt", { p_order_id: orderId });
  if (error) return rpcFailure(error, "Couldn't resend the receipt.");
  kickOutbox();
  refresh(orderId);
  return { ok: true, message: "Receipt on its way to the customer." };
}

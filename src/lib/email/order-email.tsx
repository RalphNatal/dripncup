import "server-only";

/**
 * Builds one customer email for an outbox row, from the order as it is now:
 * the same order detail the tracker reads, so a receipt and the order page
 * always agree. Decides, at send time, whether the email is still owed (an
 * account deleted in the meantime, or a "ready" email for an order already
 * picked up, gets nothing).
 */
import { render } from "react-email";

import {
  OrderCancelledEmail,
  OrderReadyEmail,
  OrderReceiptEmail,
  orderCancelledText,
  orderReadyText,
  orderReceiptText,
  type EmailBreakdownRow,
  type OrderEmailData,
} from "@/emails/order-emails";
import { BRAND } from "@/lib/brand";
import { clientEnv } from "@/lib/env";
import { formatCents, formatTaxRate } from "@/lib/money";
import { ORDER_DETAIL_SELECT, paymentMethodLabel, toOrderDetail, type OrderDetail, type OrderDetailRow } from "@/lib/orders/detail";
import { plainCancellationReason, refundSentence } from "@/lib/orders/timeline";
import { formatPoints, pointsNoteState } from "@/lib/rewards/model";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCafeDate, formatCafeTimeOfDay } from "@/lib/time";

export type EmailKind = "order_receipt" | "order_cancelled" | "order_refunded" | "order_ready";

export type ComposedEmail =
  | { send: true; to: string; subject: string; html: string; text: string }
  | { send: false; reason: string };

function pickupLine(order: OrderDetail): string | null {
  if (order.pickupType === "scheduled" && order.scheduledFor) {
    const at = new Date(order.scheduledFor);
    return `Pickup ${formatCafeDate(at)} at ${formatCafeTimeOfDay(at)}`;
  }
  return order.estimatedReadyAt ? `Ready around ${formatCafeTimeOfDay(new Date(order.estimatedReadyAt))}` : null;
}

/** The receipt rows, in calculateOrderTotal's order: promo, then each reward ("Free drink: Latte"). */
export function breakdownRows(totals: OrderDetail["totals"], rewards: OrderDetail["rewards"] = []): EmailBreakdownRow[] {
  const rows: EmailBreakdownRow[] = [{ label: "Subtotal", amount: formatCents(totals.subtotalCents) }];
  if (totals.promoDiscountCents > 0) {
    rows.push({ label: totals.promoCode ? `Promo (${totals.promoCode})` : "Discount", amount: `−${formatCents(totals.promoDiscountCents)}` });
  }
  for (const reward of rewards) {
    rows.push({ label: reward.label, amount: `−${formatCents(reward.discountCents)}` });
  }
  rows.push({ label: `Tax (GET ${formatTaxRate(totals.taxRate)})`, amount: formatCents(totals.taxCents) });
  rows.push({ label: "Tip", amount: formatCents(totals.tipCents) });
  rows.push({ label: "Total", amount: formatCents(totals.totalCents), strong: true });
  return rows;
}

export function emailDataOf(order: OrderDetail): OrderEmailData {
  return {
    orderNumber: order.orderNumber,
    cupName: order.cupName,
    locationName: order.location.name,
    locationAddress: order.location.addressOneLine || null,
    pickupInstructions: order.location.pickupInstructions,
    pickupLine: pickupLine(order),
    items: order.items.map((item) => ({
      quantity: item.quantity,
      name: item.name,
      details: [item.sizeName, ...item.options].filter(Boolean).join(" · "),
      specialInstructions: item.specialInstructions,
      rewardNotes: item.rewardNotes,
      total: formatCents(item.lineTotalCents),
    })),
    breakdown: breakdownRows(order.totals, order.rewards),
    paymentMethod:
      paymentMethodLabel(order.payment?.method ?? null) ??
      (order.totals.totalCents === 0 && order.rewards.length > 0 ? `${BRAND.loyaltyProgramName} points` : null),
    pointsLine:
      order.points.toEarn > 0 && pointsNoteState(order.status) === "upcoming"
        ? `You'll earn ${formatPoints(order.points.toEarn)} with ${BRAND.loyaltyProgramName} when you pick this up.`
        : null,
    trackUrl: new URL(`/orders/${order.id}`, clientEnv.NEXT_PUBLIC_SITE_URL).toString(),
  };
}

export async function composeOrderEmail(kind: EmailKind, orderId: string): Promise<ComposedEmail> {
  const db = createAdminClient();
  const { data } = await db.from("orders").select(`${ORDER_DETAIL_SELECT}, customer_email`).eq("id", orderId).maybeSingle();
  if (!data) return { send: false, reason: "order not found" };
  const row = data as unknown as OrderDetailRow & { customer_email: string | null };
  const order = toOrderDetail(row);

  // The address given at checkout, else the account's; neither after an account deletion.
  const { data: profile } = order.userId
    ? await db.from("profiles").select("email, notification_prefs, deleted_at").eq("id", order.userId).maybeSingle()
    : { data: null };
  const to = row.customer_email ?? (profile && !profile.deleted_at ? profile.email : null);
  if (!to || !order.userId) return { send: false, reason: "no recipient" };

  const emailData = emailDataOf(order);

  switch (kind) {
    case "order_receipt":
      return {
        send: true,
        to,
        subject: `Your ${BRAND.name} receipt · ${order.orderNumber}`,
        html: await render(<OrderReceiptEmail data={emailData} />),
        text: orderReceiptText(emailData),
      };

    case "order_cancelled":
    case "order_refunded": {
      const variant = kind === "order_cancelled" ? "cancelled" : "refunded";
      const reason = variant === "cancelled" || !order.times.pickedUp ? plainCancellationReason(order.cancellationReason) : null;
      const refund = refundSentence(order.payment);
      return {
        send: true,
        to,
        subject: variant === "cancelled" ? `Order ${order.orderNumber} was cancelled` : `Your refund for order ${order.orderNumber}`,
        html: await render(<OrderCancelledEmail data={emailData} kind={variant} reason={reason} refund={refund} />),
        text: orderCancelledText(emailData, variant, reason, refund),
      };
    }

    case "order_ready": {
      const prefs = profile?.notification_prefs as { order_ready_email?: unknown } | null | undefined;
      if (prefs?.order_ready_email !== true) return { send: false, reason: "customer turned ready emails off" };
      if (order.status !== "ready") return { send: false, reason: `order is ${order.status}, no longer ready` };
      return {
        send: true,
        to,
        subject: `Order ${order.orderNumber} is ready! 🎉`,
        html: await render(<OrderReadyEmail data={emailData} />),
        text: orderReadyText(emailData),
      };
    }
  }
}

import "server-only";

/**
 * Payment webhook handling, provider-agnostic (it sees PaymentEvents, not
 * Stripe objects).
 *
 * Safe to replay and safe out of order:
 *   - each event id is recorded in `webhook_events`; one already processed is
 *     skipped, one that failed half-way is processed again
 *   - every handler reads the current state under a row lock (in SQL) and
 *     only ever moves forward: a late "failed" never undoes a success, a
 *     success after a refund never re-places the order, a replayed success
 *     never double-counts a promo
 *
 * The order becomes Placed here and nowhere else.
 */
import { loadLocationSnapshot } from "@/lib/checkout/location-context";
import { isPickupStillServiceable } from "@/lib/checkout/pickup";
import { getCheckoutSettings } from "@/lib/checkout/settings";
import { createAdminClient } from "@/lib/supabase/admin";

import { ensureFullyRefunded } from "./refunds";
import type { PaymentEvent } from "./types";

/** `in_progress`: another delivery is handling this event; the route asks for a retry. */
export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "in_progress";

/** A 'processing' claim older than this is from a crashed attempt and is taken over. */
const CLAIM_TIMEOUT_MS = 2 * 60_000;

export async function processPaymentEvent(event: PaymentEvent): Promise<WebhookOutcome> {
  const db = createAdminClient();

  const { data: seen } = await db
    .from("webhook_events")
    .select("status, attempts, attempted_at")
    .eq("id", event.id)
    .maybeSingle();
  if (seen?.status === "processed") return "duplicate";
  if (seen?.status === "processing" && Date.now() - Date.parse(seen.attempted_at) < CLAIM_TIMEOUT_MS) {
    return "in_progress";
  }

  if (seen) {
    // Claim the retry; matching on `attempts` means only one delivery wins.
    const { data: claimed } = await db
      .from("webhook_events")
      .update({ status: "processing", attempts: seen.attempts + 1, attempted_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("attempts", seen.attempts)
      .select("id");
    if (!claimed?.length) return "in_progress";
  } else {
    const type = event.type === "ignored" ? event.providerType : event.type;
    const { error } = await db.from("webhook_events").insert({ id: event.id, type, status: "processing" });
    // Another delivery of the same event won the insert.
    if (error?.code === "23505") return "in_progress";
    if (error) throw new Error(`Could not record webhook event ${event.id}: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "payment.succeeded":
        await handleSucceeded(event);
        break;
      case "payment.failed":
        await handleFailed(event);
        break;
      case "payment.canceled":
        await handleCanceled(event);
        break;
      case "payment.refunded":
        await handleRefunded(event);
        break;
      case "ignored":
        break;
    }
    await db
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString(), last_error: null })
      .eq("id", event.id);
    return event.type === "ignored" ? "ignored" : "processed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("webhook_events").update({ status: "failed", last_error: message.slice(0, 1000) }).eq("id", event.id);
    // Rethrown so the route answers 500 and the provider redelivers.
    throw error;
  }
}

/** The order a payment belongs to: our payments row first, the metadata second. */
async function orderIdForPayment(paymentId: string, metadataOrderId: string | null): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("payments")
    .select("order_id")
    .eq("provider_payment_intent_id", paymentId)
    .maybeSingle();
  return data?.order_id ?? metadataOrderId;
}

async function handleSucceeded(event: Extract<PaymentEvent, { type: "payment.succeeded" }>) {
  const db = createAdminClient();
  const orderId = await orderIdForPayment(event.paymentId, event.orderId);
  if (!orderId) {
    console.warn(`Webhook ${event.id}: payment ${event.paymentId} matches no order; ignoring.`);
    return;
  }

  const { data: order } = await db
    .from("orders")
    .select("id, status, location_id, pickup_type, scheduled_for")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) {
    console.warn(`Webhook ${event.id}: order ${orderId} not found; ignoring.`);
    return;
  }

  // Has anything changed since checkout that means the cafe cannot make it?
  let rejectReason: string | null = null;
  if (order.status === "pending_payment") {
    const now = new Date();
    const [snapshot, settings] = await Promise.all([loadLocationSnapshot(order.location_id, now), getCheckoutSettings()]);
    if (!snapshot) {
      rejectReason = "This location is no longer taking orders.";
    } else {
      const check = isPickupStillServiceable(
        { pickupType: order.pickup_type, scheduledFor: order.scheduled_for ? new Date(order.scheduled_for) : null },
        { ...snapshot, onlineOrderingEnabled: settings.onlineOrderingEnabled, now },
      );
      if (!check.ok) rejectReason = `${check.reason} You've been refunded in full.`;
    }
  }

  const { data: outcome, error } = await db.rpc("mark_order_paid", {
    p_order_id: order.id,
    p_payment_intent_id: event.paymentId,
    p_charge_id: event.chargeId ?? "",
    p_amount_cents: event.amountCents,
    p_currency: event.currency,
    p_raw: { id: event.paymentId, amount: event.amountCents, currency: event.currency, charge: event.chargeId },
    p_reject_reason: rejectReason ?? undefined,
  });
  if (error) throw new Error(`mark_order_paid failed for ${order.id}: ${error.message}`);

  switch (outcome) {
    case "rejected":
      await ensureFullyRefunded(order.id, rejectReason ?? "Order could not be fulfilled");
      break;
    case "not_pending":
      // Paid after the order was cancelled (expired, account deleted, or
      // refunded first). Return whatever has not already gone back.
      await ensureFullyRefunded(order.id, "Payment arrived after the order was cancelled");
      break;
    case "amount_mismatch":
      console.error(
        `Order ${order.id}: payment ${event.paymentId} of ${event.amountCents} ${event.currency} does not match the order. Flagged for review.`,
      );
      break;
    default:
      break;
  }
}

async function handleFailed(event: Extract<PaymentEvent, { type: "payment.failed" }>) {
  const { error } = await createAdminClient().rpc("record_payment_failure", {
    p_payment_intent_id: event.paymentId,
    p_code: event.failureCode ?? "",
    p_message: event.failureMessage ?? "",
  });
  if (error) throw new Error(`record_payment_failure failed: ${error.message}`);
}

/**
 * The payment can no longer be completed (our expiry job cancelled it, or it
 * was cancelled in the Stripe dashboard). An order still waiting for it is
 * cancelled; one already cancelled or placed is left alone.
 */
async function handleCanceled(event: Extract<PaymentEvent, { type: "payment.canceled" }>) {
  const db = createAdminClient();
  const orderId = await orderIdForPayment(event.paymentId, event.orderId);

  await db
    .from("payments")
    .update({ status: "cancelled" })
    .eq("provider_payment_intent_id", event.paymentId)
    .in("status", ["requires_payment", "processing", "failed"]);

  if (!orderId) return;
  // The status filter makes this a no-op for anything already past pending,
  // and the transition trigger would refuse anything else anyway.
  const { error } = await db
    .from("orders")
    .update({ status: "cancelled", cancellation_reason: "The payment was cancelled before it completed." })
    .eq("id", orderId)
    .eq("status", "pending_payment");
  if (error) throw new Error(`Could not cancel order ${orderId}: ${error.message}`);
}

async function handleRefunded(event: Extract<PaymentEvent, { type: "payment.refunded" }>) {
  const db = createAdminClient();
  const { data: payment } = await db
    .from("payments")
    .select("id, order_id")
    .eq("provider_payment_intent_id", event.paymentId)
    .maybeSingle();
  if (!payment) {
    console.warn(`Webhook ${event.id}: refund for unknown payment ${event.paymentId}; ignoring.`);
    return;
  }

  for (const refund of event.refunds) {
    const fields = {
      provider_refund_id: refund.id,
      status: refund.status,
      amount_cents: refund.amountCents,
      failure_reason: refund.failureReason,
    };
    if (refund.refundRowId) {
      // One we started: fill in the provider's id and outcome.
      await db.from("refunds").update(fields).eq("id", refund.refundRowId);
    } else {
      // Started outside the app (the Stripe dashboard): record it.
      await db.from("refunds").upsert(
        { ...fields, order_id: payment.order_id, payment_id: payment.id, reason: "Refunded outside the app" },
        { onConflict: "provider_refund_id" },
      );
    }
  }

  const { error } = await db.rpc("apply_refund_state", {
    p_payment_intent_id: event.paymentId,
    p_refunded_cents: event.amountRefundedCents,
    p_reason: "Payment refunded",
  });
  if (error) throw new Error(`apply_refund_state failed: ${error.message}`);
}

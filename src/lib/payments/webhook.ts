import "server-only";

/**
 * Payment webhook handling, provider-agnostic (it sees PaymentEvents, not
 * Stripe objects), for orders and catering quotes alike.
 *
 * Safe to replay and safe out of order:
 *   - each event id is recorded in `webhook_events`; one already processed is
 *     skipped, one that failed half-way is processed again
 *   - every handler reads the current state under a row lock (in SQL) and
 *     only ever moves forward: a late "failed" never undoes a success, a
 *     success after a refund never re-places the order, a replayed success
 *     never double-counts a promo or re-confirms a catering request
 *
 * An order becomes Placed, and a catering request Confirmed, here or in the
 * reconcile fallback (./reconcile.ts), which reads the same success from the
 * provider's API and runs the same handler.
 */
import { loadLocationSnapshot } from "@/lib/checkout/location-context";
import { isPickupStillServiceable } from "@/lib/checkout/pickup";
import { getCheckoutSettings } from "@/lib/checkout/settings";
import { createAdminClient } from "@/lib/supabase/admin";

import { ensureFullyRefunded, refundPayment } from "./refunds";
import type { PaymentEvent, PaymentMethodSummary, PaymentTarget } from "./types";

/** `in_progress`: another delivery is handling this event; the route asks for a retry. */
export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "in_progress";

type SucceededEvent = Extract<PaymentEvent, { type: "payment.succeeded" }>;

/** A 'processing' claim older than this is from a crashed attempt and is taken over. */
const CLAIM_TIMEOUT_MS = 2 * 60_000;

export async function processPaymentEvent(event: PaymentEvent): Promise<WebhookOutcome> {
  const db = createAdminClient();

  // Nothing to do, so nothing to record: event types we don't handle, and
  // payments this database never made. Everything sharing the Stripe sandbox
  // reaches whichever server `stripe listen` forwards to (e2e runs, another
  // developer's machine), and none of it belongs in this database's log.
  if (event.type === "ignored") return "ignored";
  if (!(await isOurPayment(event))) {
    console.info(`Webhook ${event.id}: payment ${event.paymentId} is not from this database; ignoring.`);
    return "ignored";
  }

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
    const { error } = await db.from("webhook_events").insert({ id: event.id, type: event.type, status: "processing" });
    // Another delivery of the same event won the insert.
    if (error?.code === "23505") return "in_progress";
    if (error) throw new Error(`Could not record webhook event ${event.id}: ${error.message}`);
  }

  try {
    switch (event.type) {
      case "payment.succeeded":
        await applyPaymentSucceeded(event);
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
    }
    await db
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString(), last_error: null })
      .eq("id", event.id);
    return "processed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("webhook_events").update({ status: "failed", last_error: message.slice(0, 1000) }).eq("id", event.id);
    // Rethrown so the route answers 500 and the provider redelivers.
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a payment belongs to: our payments row first, the provider's metadata second. */
type Owner =
  | { kind: "order"; orderId: string }
  | { kind: "catering"; requestId: string; quoteId: string | null }
  | null;

async function ownerOf(paymentId: string, target: PaymentTarget | null): Promise<Owner> {
  const { data } = await createAdminClient()
    .from("payments")
    .select("order_id, catering_request_id, catering_quote_id")
    .eq("provider_payment_intent_id", paymentId)
    .maybeSingle();
  if (data?.order_id) return { kind: "order", orderId: data.order_id };
  if (data?.catering_request_id) return { kind: "catering", requestId: data.catering_request_id, quoteId: data.catering_quote_id };
  if (target?.kind === "catering" && target.cateringRequestId && UUID.test(target.cateringRequestId)) {
    const quoteId = target.cateringQuoteId && UUID.test(target.cateringQuoteId) ? target.cateringQuoteId : null;
    return { kind: "catering", requestId: target.cateringRequestId, quoteId };
  }
  if (target?.orderId && UUID.test(target.orderId)) return { kind: "order", orderId: target.orderId };
  return null;
}

/**
 * Whether this database made the payment: a payments row for it, or the
 * order or catering request its metadata names. (Both are created before
 * their PaymentIntent, so an event for one of ours can never arrive first.)
 */
async function isOurPayment(event: Exclude<PaymentEvent, { type: "ignored" }>): Promise<boolean> {
  const owner = await ownerOf(event.paymentId, "target" in event ? event.target : null);
  if (!owner) return false;
  const db = createAdminClient();
  const { data } =
    owner.kind === "order"
      ? await db.from("orders").select("id").eq("id", owner.orderId).maybeSingle()
      : await db.from("catering_requests").select("id").eq("id", owner.requestId).maybeSingle();
  return Boolean(data);
}

/** For the receipt. Best effort: a receipt without the card is still a receipt. */
async function recordMethod(paymentId: string, method: PaymentMethodSummary | null) {
  if (!method) return;
  const { error } = await createAdminClient()
    .from("payments")
    .update({
      method_brand: method.brand,
      method_last4: method.last4 && /^\d{4}$/.test(method.last4) ? method.last4 : null,
      method_wallet: method.wallet,
    })
    .eq("provider_payment_intent_id", paymentId);
  if (error) console.warn(`Could not record the payment method for ${paymentId}: ${error.message}`);
}

/**
 * A payment succeeded: the webhook's handler, also run by the reconcile
 * fallback with the same facts read from the provider's API. Idempotent.
 */
export async function applyPaymentSucceeded(event: SucceededEvent) {
  const owner = await ownerOf(event.paymentId, event.target);
  if (!owner) {
    console.warn(`Payment ${event.paymentId} (${event.id}) matches no order or catering request; ignoring.`);
    return;
  }
  if (owner.kind === "catering") return applyCateringSucceeded(event, owner);
  return applyOrderSucceeded(event, owner.orderId);
}

async function applyOrderSucceeded(event: SucceededEvent, orderId: string) {
  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, status, location_id, pickup_type, scheduled_for")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) {
    console.warn(`Payment ${event.paymentId} (${event.id}): order ${orderId} not found; ignoring.`);
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

  await recordMethod(event.paymentId, event.method);

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

/** Reasons a catering payment is given back, as the customer reads them. */
const CATERING_REFUND_REASONS = {
  not_payable:
    "Your quote changed, or the request was cancelled, while you were paying. You've been refunded in full; please review the latest quote.",
  too_late: "Your payment arrived after the payment deadline for this event. You've been refunded in full; please contact us.",
} as const;

async function applyCateringSucceeded(event: SucceededEvent, owner: { requestId: string; quoteId: string | null }) {
  const db = createAdminClient();
  const quoteId = owner.quoteId ?? event.target.cateringQuoteId;
  if (!quoteId) {
    console.error(`Catering payment ${event.paymentId} names no quote; flag it for an admin.`);
    return;
  }

  const { data: outcome, error } = await db.rpc("mark_catering_paid", {
    p_request_id: owner.requestId,
    p_quote_id: quoteId,
    p_payment_intent_id: event.paymentId,
    p_charge_id: event.chargeId ?? "",
    p_amount_cents: event.amountCents,
    p_currency: event.currency,
    p_raw: { id: event.paymentId, amount: event.amountCents, currency: event.currency, charge: event.chargeId },
  });
  if (error) throw new Error(`mark_catering_paid failed for ${owner.requestId}: ${error.message}`);

  await recordMethod(event.paymentId, event.method);

  switch (outcome) {
    case "not_payable":
    case "too_late":
      await refundPayment({
        subject: { kind: "catering", requestId: owner.requestId, paymentIntentId: event.paymentId },
        reason: CATERING_REFUND_REASONS[outcome],
        requestedBy: null,
      });
      break;
    case "amount_mismatch":
      console.error(
        `Catering ${owner.requestId}: payment ${event.paymentId} of ${event.amountCents} ${event.currency} does not match quote ${quoteId}. Flagged for review.`,
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
 * The payment can no longer be completed (our expiry job cancelled it, it
 * was cancelled because its catering quote changed, or it was cancelled in
 * the Stripe dashboard). An order still waiting for it is cancelled; a
 * catering quote stays payable with a new payment.
 */
async function handleCanceled(event: Extract<PaymentEvent, { type: "payment.canceled" }>) {
  const db = createAdminClient();
  const owner = await ownerOf(event.paymentId, event.target);

  await db
    .from("payments")
    .update({ status: "cancelled" })
    .eq("provider_payment_intent_id", event.paymentId)
    .in("status", ["requires_payment", "processing", "failed"]);

  if (owner?.kind !== "order") return;
  // The status filter makes this a no-op for anything already past pending,
  // and the transition trigger would refuse anything else anyway.
  const { error } = await db
    .from("orders")
    .update({ status: "cancelled", cancellation_reason: "The payment was cancelled before it completed." })
    .eq("id", owner.orderId)
    .eq("status", "pending_payment");
  if (error) throw new Error(`Could not cancel order ${owner.orderId}: ${error.message}`);
}

async function handleRefunded(event: Extract<PaymentEvent, { type: "payment.refunded" }>) {
  const db = createAdminClient();
  const { data: payment } = await db
    .from("payments")
    .select("id, order_id, catering_request_id")
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
        {
          ...fields,
          order_id: payment.order_id,
          catering_request_id: payment.catering_request_id,
          payment_id: payment.id,
          reason: "Refunded outside the app",
        },
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

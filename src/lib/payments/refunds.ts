import "server-only";

/**
 * Refunds, for orders and catering requests alike. Every attempt gets a
 * `refunds` row *before* the provider is called, so a crash, a timeout or a
 * decline all leave a record: a `failed` row is the admin retry queue
 * (screen in Phase 9). The row id travels to the provider as metadata, which
 * is how the refund webhook finds it again.
 */
import { paymentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

export type RefundOutcome =
  | { ok: true; refundId: string; status: string; amountCents: number }
  | { ok: false; reason: "nothing_to_refund" | "no_payment" }
  | { ok: false; reason: "failed"; refundId: string; message: string };

/**
 * What the money was for. A catering request can hold more than one payment
 * (a stray one for a quote revised mid-payment); `paymentIntentId` picks it,
 * otherwise the latest captured one is refunded.
 */
export type RefundSubject =
  | { kind: "order"; orderId: string }
  | { kind: "catering"; requestId: string; paymentIntentId?: string };

/** Money on the subject's payment not yet refunded or on its way back. */
async function outstanding(subject: RefundSubject) {
  const db = createAdminClient();
  let query = db
    .from("payments")
    .select("id, provider_payment_intent_id, amount_cents, refunded_cents, status")
    .in("status", ["succeeded", "partially_refunded"])
    .order("created_at", { ascending: false })
    .limit(1);
  query =
    subject.kind === "order"
      ? query.eq("order_id", subject.orderId)
      : subject.paymentIntentId
        ? query.eq("catering_request_id", subject.requestId).eq("provider_payment_intent_id", subject.paymentIntentId)
        : query.eq("catering_request_id", subject.requestId);
  const { data: payment } = await query.maybeSingle();
  if (!payment?.provider_payment_intent_id) return null;

  const { data: inFlight } = await db
    .from("refunds")
    .select("amount_cents, status")
    .eq("payment_id", payment.id)
    .in("status", ["pending", "requires_action", "succeeded"]);
  const claimed = (inFlight ?? []).reduce((sum, r) => sum + r.amount_cents, 0);

  return {
    payment,
    // Both columns can be ahead of each other briefly; take the larger.
    remainingCents: payment.amount_cents - Math.max(payment.refunded_cents, claimed),
  };
}

/** What a subject's payment could still give back (0 when nothing was taken). */
export async function refundableCents(subject: RefundSubject): Promise<number> {
  const state = await outstanding(subject);
  return Math.max(0, state?.remainingCents ?? 0);
}

/**
 * Refunds part or all of a payment. Never throws for a provider failure: the
 * failure is recorded and reported, so callers such as account deletion can
 * carry on.
 */
export async function refundPayment({
  subject,
  amountCents,
  reason,
  requestedBy,
}: {
  subject: RefundSubject;
  /** Omit for everything still outstanding. */
  amountCents?: number;
  reason: string;
  requestedBy: string | null;
}): Promise<RefundOutcome> {
  const state = await outstanding(subject);
  if (!state) return { ok: false, reason: "no_payment" };

  const amount = Math.min(amountCents ?? state.remainingCents, state.remainingCents);
  if (amount <= 0) return { ok: false, reason: "nothing_to_refund" };

  const db = createAdminClient();
  const { data: row, error } = await db
    .from("refunds")
    .insert({
      order_id: subject.kind === "order" ? subject.orderId : null,
      catering_request_id: subject.kind === "catering" ? subject.requestId : null,
      payment_id: state.payment.id,
      provider: paymentProvider().name,
      amount_cents: amount,
      reason,
      requested_by: requestedBy,
      status: "pending",
    })
    .select("id, attempts")
    .single();
  const label = subject.kind === "order" ? `order ${subject.orderId}` : `catering request ${subject.requestId}`;
  if (error || !row) throw new Error(`Could not record a refund for ${label}: ${error?.message}`);

  return attemptRefund(row.id, state.payment.provider_payment_intent_id!, amount, reason, row.attempts);
}

/** Refunds part or all of an order's payment (see refundPayment). */
export function refundOrder({
  orderId,
  ...rest
}: {
  orderId: string;
  amountCents?: number;
  reason: string;
  requestedBy: string | null;
}): Promise<RefundOutcome> {
  return refundPayment({ subject: { kind: "order", orderId }, ...rest });
}

async function attemptRefund(
  refundId: string,
  paymentId: string,
  amountCents: number,
  reason: string,
  attempt: number,
): Promise<RefundOutcome> {
  const db = createAdminClient();
  try {
    const refund = await paymentProvider().refund({ paymentId, amountCents, reason, refundRowId: refundId, attempt });
    await db
      .from("refunds")
      .update({ provider_refund_id: refund.id, status: refund.status, failure_reason: refund.failureReason })
      .eq("id", refundId);

    if (refund.status === "succeeded") {
      const { data: payment } = await db
        .from("payments")
        .select("refunded_cents")
        .eq("provider_payment_intent_id", paymentId)
        .single();
      await db.rpc("apply_refund_state", {
        p_payment_intent_id: paymentId,
        p_refunded_cents: (payment?.refunded_cents ?? 0) + amountCents,
        p_reason: reason,
      });
    }
    return { ok: true, refundId, status: refund.status, amountCents };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Refund ${refundId} failed`, error);
    await db.from("refunds").update({ status: "failed", failure_reason: message.slice(0, 500) }).eq("id", refundId);
    return { ok: false, reason: "failed", refundId, message };
  }
}

/** Admin retry of a failed refund (Phase 9 wires this to a button). */
export async function retryRefund(refundId: string): Promise<RefundOutcome> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("refunds")
    .select("id, amount_cents, reason, status, attempts, payments(provider_payment_intent_id)")
    .eq("id", refundId)
    .single();
  const paymentId = row?.payments?.provider_payment_intent_id;
  if (!row || row.status !== "failed" || !paymentId) return { ok: false, reason: "nothing_to_refund" };

  const attempts = row.attempts + 1;
  await db.from("refunds").update({ status: "pending", attempts, failure_reason: null }).eq("id", refundId);
  return attemptRefund(row.id, paymentId, row.amount_cents, row.reason, attempts);
}

/**
 * For money that should not have been taken (payment after the order was
 * cancelled, or after the location stopped taking orders): refund whatever
 * is left, once.
 */
export async function ensureFullyRefunded(orderId: string, reason: string): Promise<RefundOutcome> {
  return refundOrder({ orderId, reason, requestedBy: null });
}

import "server-only";

/**
 * Stripe implementation of PaymentProvider.
 *
 * Only this file imports the Stripe SDK. The secret key never leaves the
 * server; the browser gets the publishable key and a per-payment client
 * secret, and card details go straight from the Payment Element to Stripe.
 */
import Stripe from "stripe";

import { stripeEnv } from "@/lib/env";

import {
  WebhookSignatureError,
  type CreatePaymentInput,
  type PaymentEvent,
  type PaymentMethodSummary,
  type PaymentProvider,
  type PaymentStatus,
  type ProviderPayment,
  type ProviderRefund,
  type RefundInput,
} from "./types";

let client: Stripe | undefined;

function stripe(): Stripe {
  client ??= new Stripe(stripeEnv().secretKey, {
    // Retries network blips; idempotency keys make that safe.
    maxNetworkRetries: 2,
    appInfo: { name: "Drincup Cafe" },
  });
  return client;
}

function toStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "processing":
      return "processing";
    case "canceled":
      return "canceled";
    case "requires_action":
      return "requires_action";
    default:
      // requires_payment_method, requires_confirmation, requires_capture
      return "requires_payment";
  }
}

function toPayment(intent: Stripe.PaymentIntent): ProviderPayment {
  if (!intent.client_secret) throw new Error(`PaymentIntent ${intent.id} has no client secret`);
  return { id: intent.id, clientSecret: intent.client_secret, status: toStatus(intent.status), amountCents: intent.amount };
}

function toRefund(refund: Stripe.Refund): ProviderRefund & { refundRowId: string | null } {
  const status = (refund.status ?? "pending") as ProviderRefund["status"];
  return {
    id: refund.id,
    status: ["pending", "requires_action", "succeeded", "failed", "canceled"].includes(status) ? status : "pending",
    amountCents: refund.amount,
    failureReason: refund.failure_reason ?? null,
    refundRowId: refund.metadata?.refund_row_id ?? null,
  };
}

const idOf = (value: string | { id: string } | null | undefined) =>
  value == null ? null : typeof value === "string" ? value : value.id;

/**
 * Marks payments made by an e2e run, so the sandbox dashboard tells them
 * apart from hand testing (search `metadata['source']:'e2e'`). E2E_RUN_ID is
 * set only on the Playwright test server (playwright.config.ts).
 */
function testRunTag(): { metadata: Record<string, string>; descriptionPrefix: string } {
  const run = process.env.E2E_RUN_ID?.trim();
  return run ? { metadata: { source: "e2e", e2e_run: run }, descriptionPrefix: "[e2e] " } : { metadata: {}, descriptionPrefix: "" };
}

/**
 * Brand, last four and wallet from the charge, for the receipt. Webhook
 * payloads carry only the charge id, so this is one extra call; if it fails
 * the order is placed anyway and the receipt just omits the card.
 */
async function methodOfCharge(chargeId: string | null): Promise<PaymentMethodSummary | null> {
  if (!chargeId) return null;
  try {
    const charge = await stripe().charges.retrieve(chargeId);
    const details = charge.payment_method_details;
    if (!details) return null;
    if (details.card) {
      return { brand: details.card.brand ?? null, last4: details.card.last4 ?? null, wallet: details.card.wallet?.type ?? null };
    }
    return { brand: null, last4: null, wallet: details.type ?? null };
  } catch (error) {
    console.warn(`Could not read the payment method of charge ${chargeId}`, error);
    return null;
  }
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",

  async createPayment(input: CreatePaymentInput) {
    const tag = testRunTag();
    const intent = await stripe().paymentIntents.create(
      {
        amount: input.amountCents,
        currency: input.currency,
        // Cards plus whatever wallets and methods are enabled in the dashboard.
        automatic_payment_methods: { enabled: true },
        description: input.description ? `${tag.descriptionPrefix}${input.description}` : undefined,
        receipt_email: input.customerEmail ?? undefined,
        metadata: { order_id: input.orderId, order_number: input.orderNumber, ...tag.metadata },
      },
      { idempotencyKey: `checkout-${input.idempotencyKey}` },
    );
    return toPayment(intent);
  },

  async retrievePayment(paymentId: string) {
    return toPayment(await stripe().paymentIntents.retrieve(paymentId));
  },

  async cancelPayment(paymentId: string) {
    try {
      const intent = await stripe().paymentIntents.cancel(paymentId, { cancellation_reason: "abandoned" });
      return toStatus(intent.status);
    } catch (error) {
      // Already succeeded, processing or cancelled: report where it stands.
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        return toStatus((await stripe().paymentIntents.retrieve(paymentId)).status);
      }
      throw error;
    }
  },

  async refund(input: RefundInput) {
    const refund = await stripe().refunds.create(
      {
        payment_intent: input.paymentId,
        amount: input.amountCents,
        reason: "requested_by_customer",
        metadata: { refund_row_id: input.refundRowId, note: input.reason.slice(0, 450), ...testRunTag().metadata },
      },
      { idempotencyKey: `refund-${input.refundRowId}-${input.attempt}` },
    );
    return toRefund(refund);
  },

  async verifyWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent> {
    if (!signature) throw new WebhookSignatureError("Missing Stripe-Signature header");

    let event: Stripe.Event;
    try {
      event = await stripe().webhooks.constructEventAsync(rawBody, signature, stripeEnv().webhookSecret);
    } catch {
      throw new WebhookSignatureError();
    }

    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object;
        const chargeId = idOf(intent.latest_charge);
        return {
          id: event.id,
          type: "payment.succeeded",
          paymentId: intent.id,
          orderId: intent.metadata?.order_id ?? null,
          amountCents: intent.amount_received || intent.amount,
          currency: intent.currency,
          chargeId,
          method: await methodOfCharge(chargeId),
        };
      }
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        return {
          id: event.id,
          type: "payment.failed",
          paymentId: intent.id,
          orderId: intent.metadata?.order_id ?? null,
          failureCode: intent.last_payment_error?.decline_code ?? intent.last_payment_error?.code ?? null,
          failureMessage: intent.last_payment_error?.message ?? null,
        };
      }
      case "payment_intent.canceled": {
        const intent = event.data.object;
        return {
          id: event.id,
          type: "payment.canceled",
          paymentId: intent.id,
          orderId: intent.metadata?.order_id ?? null,
        };
      }
      case "charge.refunded": {
        const charge = event.data.object;
        const paymentId = idOf(charge.payment_intent);
        if (!paymentId) return { id: event.id, type: "ignored", providerType: event.type };
        // Newer API versions no longer embed refunds on the charge; list them.
        const refunds = await stripe().refunds.list({ charge: charge.id, limit: 100 });
        return {
          id: event.id,
          type: "payment.refunded",
          paymentId,
          chargeId: charge.id,
          amountRefundedCents: charge.amount_refunded,
          refunds: refunds.data.map(toRefund),
        };
      }
      default:
        return { id: event.id, type: "ignored", providerType: event.type };
    }
  },
};

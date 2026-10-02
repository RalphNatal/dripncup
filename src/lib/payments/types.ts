/**
 * The payment-provider seam.
 *
 * Checkout, the webhook, refunds and the expiry job talk only to this
 * interface and these normalised shapes. Stripe is the one implementation
 * today (./stripe.ts); if the cafe's POS turns out to need Square or another
 * processor, a second implementation slots in without touching order logic.
 */

export type ProviderName = "stripe";

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: string;
  amountCents: number;
  currency: "usd";
  /** One per checkout attempt; a retry returns the same payment. */
  idempotencyKey: string;
  customerEmail: string | null;
  description: string;
}

export interface ProviderPayment {
  /** Stripe: the PaymentIntent id. */
  id: string;
  /** Handed to the browser to confirm the payment. Never stored. */
  clientSecret: string;
  status: PaymentStatus;
  amountCents: number;
}

export type PaymentStatus = "requires_payment" | "requires_action" | "processing" | "succeeded" | "canceled";

export interface RefundInput {
  paymentId: string;
  /** Omit for a full refund of whatever has not been refunded yet. */
  amountCents?: number;
  reason: string;
  /** Our refunds row id: lets the webhook match the provider's refund to it. */
  refundRowId: string;
  /**
   * 1 for the first try, then +1 per admin retry. Part of the idempotency key:
   * a network retry of the same attempt is deduplicated, while a deliberate
   * retry after a failure gets a fresh key (a failed key would replay the
   * same failure).
   */
  attempt: number;
}

export interface ProviderRefund {
  id: string;
  status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled";
  amountCents: number;
  failureReason: string | null;
}

/** How the customer paid, as a receipt shows it. Never more than brand and last four. */
export interface PaymentMethodSummary {
  /** "visa", "mastercard", "amex"; null for a non-card method. */
  brand: string | null;
  last4: string | null;
  /** "apple_pay", "google_pay", "link"; null for a typed-in card. */
  wallet: string | null;
}

/** A verified webhook event, reduced to what order handling needs. */
export type PaymentEvent =
  | {
      id: string;
      type: "payment.succeeded";
      paymentId: string;
      orderId: string | null;
      amountCents: number;
      currency: string;
      chargeId: string | null;
      /** Null when the provider could not say (the order is still placed). */
      method: PaymentMethodSummary | null;
    }
  | {
      id: string;
      type: "payment.failed";
      paymentId: string;
      orderId: string | null;
      failureCode: string | null;
      failureMessage: string | null;
    }
  | {
      id: string;
      type: "payment.canceled";
      paymentId: string;
      orderId: string | null;
    }
  | {
      id: string;
      type: "payment.refunded";
      paymentId: string;
      chargeId: string;
      amountRefundedCents: number;
      refunds: (ProviderRefund & { refundRowId: string | null })[];
    }
  | { id: string; type: "ignored"; providerType: string };

export interface PaymentProvider {
  readonly name: ProviderName;
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  /** Current state, including the client secret for a retry. */
  retrievePayment(paymentId: string): Promise<ProviderPayment>;
  /** Stops an unpaid payment being completed later. Returns the resulting status. */
  cancelPayment(paymentId: string): Promise<PaymentStatus>;
  refund(input: RefundInput): Promise<ProviderRefund>;
  /** Throws when the signature does not verify against the raw body. */
  verifyWebhook(rawBody: string, signature: string | null): Promise<PaymentEvent>;
}

/** Thrown for a bad webhook signature, so the route can answer 400. */
export class WebhookSignatureError extends Error {
  constructor(message = "Webhook signature verification failed") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

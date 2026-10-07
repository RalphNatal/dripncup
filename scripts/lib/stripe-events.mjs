/**
 * The Stripe events the webhook handles (src/lib/payments/stripe.ts,
 * verifyWebhook). One list for `npm run stripe:listen`, `npm run
 * stripe:doctor`, the README and the production webhook endpoint;
 * tests/stripe-events.test.ts fails if it and the handler drift apart.
 *
 * Catering payments (Phase 8) use the same four events: they are
 * PaymentIntents too, told apart by `metadata.type = catering`.
 */
export const STRIPE_WEBHOOK_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "charge.refunded",
];

export const WEBHOOK_PATH = "/api/webhooks/stripe";

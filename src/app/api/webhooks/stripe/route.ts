/**
 * Stripe webhook: POST /api/webhooks/stripe
 *
 * The body is read raw -- the signature covers the exact bytes Stripe sent,
 * and parsing then re-serialising JSON would break it. 400 for a bad
 * signature (Stripe does not retry), 409 while another delivery of the same
 * event is being handled and 500 if handling failed (Stripe retries both with
 * backoff; handlers are idempotent), 200 otherwise.
 */
import { NextResponse } from "next/server";

import { WebhookSignatureError, paymentProvider } from "@/lib/payments";
import { processPaymentEvent } from "@/lib/payments/webhook";

export async function POST(request: Request) {
  const rawBody = await request.text();

  let event;
  try {
    event = await paymentProvider().verifyWebhook(rawBody, request.headers.get("stripe-signature"));
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    console.error("Stripe webhook: could not read event", error);
    return NextResponse.json({ error: "Could not read event" }, { status: 500 });
  }

  try {
    const outcome = await processPaymentEvent(event);
    // Another delivery is mid-way through this event: a non-2xx makes Stripe
    // try again later, by which time it is done (or needs doing again).
    if (outcome === "in_progress") return NextResponse.json({ received: false, outcome }, { status: 409 });
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    console.error(`Stripe webhook: handling ${event.id} failed`, error);
    return NextResponse.json({ error: "Handling failed" }, { status: 500 });
  }
}

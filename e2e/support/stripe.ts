/**
 * Stripe in the e2e suite: the sandbox API (test keys from .env.local),
 * signed webhook deliveries, and orders arranged the way checkout makes them.
 *
 * The test server on port 3100 is not where `stripe listen` forwards (that is
 * the dev server on 3000), so the suite delivers webhooks itself: real events
 * fetched from the Events API, or fixtures built around real PaymentIntents,
 * signed with STRIPE_WEBHOOK_SECRET exactly as Stripe signs them.
 */
import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";
import Stripe from "stripe";

import { SEEDED, db, locationIdBySlug, must } from "./db";

let client: Stripe | undefined;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("Checkout e2e tests need STRIPE_SECRET_KEY in .env.local (a test-mode key).");
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("Refusing to run e2e tests with a live Stripe key.");
  }
  client ??= new Stripe(key, { maxNetworkRetries: 2 });
  return client;
}

function webhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("Checkout e2e tests need STRIPE_WEBHOOK_SECRET in .env.local.");
  return secret;
}

export interface Delivery {
  status: number;
  body: { received?: boolean; outcome?: string; error?: string };
}

/** POSTs an event to the webhook route with a valid (or deliberately bad) signature. */
export async function deliver(request: APIRequestContext, event: object, options: { badSignature?: boolean } = {}): Promise<Delivery> {
  const payload = JSON.stringify(event);
  const signature = stripe().webhooks.generateTestHeaderString({
    payload,
    secret: options.badSignature ? "whsec_not_the_real_secret" : webhookSecret(),
  });
  const response = await request.post("/api/webhooks/stripe", {
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    data: payload,
  });
  return { status: response.status(), body: await response.json().catch(() => ({})) };
}

/** An event wrapping a real Stripe object, as Stripe would send it. */
export function fixtureEvent(type: string, object: object, id = `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`) {
  return {
    id,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  };
}

/**
 * The real event Stripe emitted for `objectId`, delivered to the test server.
 * Stripe publishes events a moment after the change, so this polls briefly.
 */
export async function relayRealEvent(
  request: APIRequestContext,
  type: string,
  objectId: string,
  { since, timeoutMs = 30_000 }: { since: number; timeoutMs?: number },
): Promise<Delivery> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await stripe().events.list({ type, created: { gte: Math.floor(since / 1000) - 5 }, limit: 100 });
    const event = events.data.find((e) => (e.data.object as { id?: string }).id === objectId);
    if (event) return deliver(request, event);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`No ${type} event for ${objectId} within ${timeoutMs / 1000}s`);
}

// ---------------------------------------------------------------------------
// Orders arranged the way createCheckout makes them.
// ---------------------------------------------------------------------------

export interface ArrangedOrder {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  intent: Stripe.PaymentIntent;
}

/**
 * A pending order (through the same create_checkout_order function checkout
 * uses) with its PaymentIntent and payments row. `pay` confirms the intent
 * server-side with one of Stripe's test payment methods.
 */
export async function arrangePendingOrder({
  userId,
  totalCents = 612,
  intentAmountCents,
  promo,
  pickupType = "asap",
  pay,
  pointsEarned = 0,
  reward,
}: {
  userId: string;
  totalCents?: number;
  /** Charge a different amount than the order says (to test the mismatch check). */
  intentAmountCents?: number;
  promo?: { id: string; code: string; discountCents: number };
  pickupType?: "asap" | "scheduled";
  pay?: "pm_card_visa" | "pm_card_chargeDeclined";
  /** Points the order earns at pickup, as checkout would have worked out. */
  pointsEarned?: number;
  /** A seeded reward redeemed on the order's line (its points are reserved). */
  reward?: { name: string; discountCents: number };
}): Promise<ArrangedOrder> {
  const locationId = await locationIdBySlug(SEEDED.cafeSlug);
  const product = must(await db().from("products").select("id, name, base_price_cents").eq("slug", "latte").single(), "latte");
  const key = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const rewardRow = reward
    ? must(await db().from("rewards").select("id, name, type, points_cost").eq("name", reward.name).single(), `reward ${reward.name}`)
    : null;
  const rewardCents = reward?.discountCents ?? 0;
  const discount = (promo?.discountCents ?? 0) + rewardCents;
  const subtotal = totalCents + discount;
  const itemId = randomUUID();

  const created = must(
    await db().rpc("create_checkout_order", {
      p_order: {
        user_id: userId,
        location_id: locationId,
        pickup_type: pickupType,
        scheduled_for: pickupType === "scheduled" ? new Date(Date.now() + 60 * 60_000).toISOString() : null,
        estimated_ready_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        subtotal_cents: subtotal,
        discount_cents: discount,
        reward_discount_cents: rewardCents,
        points_earned: pointsEarned,
        points_redeemed: rewardRow?.points_cost ?? 0,
        taxable_base_cents: totalCents,
        tax_rate: 0,
        tax_cents: 0,
        tip_cents: 0,
        total_cents: totalCents,
        promo_id: promo?.id ?? null,
        promo_code: promo?.code ?? null,
        customer_first_name: "Kai",
        customer_phone: null,
        customer_email: null,
        notes: null,
        idempotency_key: key,
        checkout_fingerprint: key,
      },
      p_items: [
        {
          id: itemId,
          product_id: product.id,
          product_size_id: null,
          product_name: product.name,
          size_name: null,
          modifiers: [],
          base_price_cents: subtotal,
          unit_price_cents: subtotal,
          quantity: 1,
          line_total_cents: subtotal,
          special_instructions: "",
        },
      ],
      p_rewards: rewardRow
        ? [
            {
              reward_id: rewardRow.id,
              reward_name: rewardRow.name,
              reward_type: rewardRow.type,
              points_cost: rewardRow.points_cost,
              discount_cents: rewardCents,
              order_item_id: rewardRow.type === "amount_off" ? null : itemId,
            },
          ]
        : [],
    }),
    "create_checkout_order",
  );
  const orderId = created[0].order_id;
  const order = must(await db().from("orders").select("order_number").eq("id", orderId).single(), "order number");

  let intent = await stripe().paymentIntents.create({
    amount: intentAmountCents ?? totalCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { order_id: orderId, order_number: order.order_number },
  });
  must(
    await db()
      .from("payments")
      .insert({
        order_id: orderId,
        provider: "stripe",
        provider_payment_intent_id: intent.id,
        status: "requires_payment",
        amount_cents: totalCents,
        tip_cents: 0,
      })
      .select()
      .single(),
    "payments row",
  );

  if (pay) {
    try {
      intent = await stripe().paymentIntents.confirm(intent.id, { payment_method: pay });
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeCardError)) throw error;
      intent = await stripe().paymentIntents.retrieve(intent.id);
    }
  }

  return { orderId, orderNumber: order.order_number, totalCents, intent };
}

export async function orderRow(orderId: string) {
  return must(
    await db()
      .from("orders")
      .select("status, placed_at, cancellation_reason, flagged_for_review_at, review_reason, promo_id")
      .eq("id", orderId)
      .single(),
    "order row",
  );
}

export async function paymentRow(intentId: string) {
  return must(
    await db()
      .from("payments")
      .select("status, refunded_cents, failure_code, failure_message, provider_charge_id")
      .eq("provider_payment_intent_id", intentId)
      .single(),
    "payment row",
  );
}

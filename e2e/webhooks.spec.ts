/**
 * The Stripe webhook and the expiry job, through HTTP, against real sandbox
 * objects. Each test arranges a pending order the way checkout does, drives
 * its PaymentIntent with Stripe's test payment methods, then delivers a
 * signed event and checks the database.
 *
 * If `stripe listen` is forwarding to a dev server on the same database, it
 * handles the real events for these PaymentIntents too. That is harmless --
 * every handler is idempotent and only moves an order forward -- and the
 * assertions hold whichever delivery lands first.
 */
import { expect, test } from "@playwright/test";

import { SEEDED, createCustomer, db, must } from "./support/db";
import { setPaused } from "./support/storefront";
import { arrangePendingOrder, deliver, fixtureEvent, orderRow, paymentRow, stripe } from "./support/stripe";

const CRON_SECRET = process.env.E2E_CRON_SECRET!;

let userId: string;

test.beforeAll(async () => {
  userId = (await createCustomer("webhook")).id;
});

test.describe("Stripe webhook", () => {
  test("rejects a delivery with a bad signature", async ({ request }) => {
    const { intent } = await arrangePendingOrder({ userId });
    const response = await deliver(request, fixtureEvent("payment_intent.succeeded", intent), { badSignature: true });
    expect(response.status).toBe(400);

    const unsigned = await request.post("/api/webhooks/stripe", { data: fixtureEvent("payment_intent.succeeded", intent) });
    expect(unsigned.status()).toBe(400);
  });

  test("payment_intent.succeeded places the order and records the payment and promo", async ({ request }) => {
    const promo = must(await db().from("promos").select("id, code, times_used").eq("code", "MAHALO10").single(), "promo");
    const arranged = await arrangePendingOrder({
      userId,
      totalCents: 1080,
      promo: { id: promo.id, code: promo.code, discountCents: 120 },
      pay: "pm_card_visa",
    });
    expect(arranged.intent.status).toBe("succeeded");

    const response = await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent));
    expect(response).toEqual({ status: 200, body: { received: true, outcome: "processed" } });

    const order = await orderRow(arranged.orderId);
    expect(order.status).toBe("placed");
    expect(order.placed_at).not.toBeNull();

    const payment = await paymentRow(arranged.intent.id);
    expect(payment.status).toBe("succeeded");
    expect(payment.provider_charge_id).toBe(arranged.intent.latest_charge);

    const redemptions = must(await db().from("promo_redemptions").select("id").eq("order_id", arranged.orderId), "redemptions");
    expect(redemptions).toHaveLength(1);
    const after = must(await db().from("promos").select("times_used").eq("id", promo.id).single(), "promo after");
    expect(after.times_used).toBe(promo.times_used + 1);
  });

  test("a duplicate delivery is processed once", async ({ request }) => {
    const promo = must(await db().from("promos").select("id, code").eq("code", "MAHALO10").single(), "promo");
    const arranged = await arrangePendingOrder({
      userId,
      totalCents: 1080,
      promo: { id: promo.id, code: promo.code, discountCents: 120 },
      pay: "pm_card_visa",
    });
    const event = fixtureEvent("payment_intent.succeeded", arranged.intent);

    expect((await deliver(request, event)).body.outcome).toBe("processed");
    const usedOnce = must(await db().from("promos").select("times_used").eq("id", promo.id).single(), "promo").times_used;

    expect(await deliver(request, event)).toEqual({ status: 200, body: { received: true, outcome: "duplicate" } });

    const usedAfter = must(await db().from("promos").select("times_used").eq("id", promo.id).single(), "promo").times_used;
    expect(usedAfter).toBe(usedOnce);
    const redemptions = must(await db().from("promo_redemptions").select("id").eq("order_id", arranged.orderId), "redemptions");
    expect(redemptions).toHaveLength(1);
    const payments = must(await db().from("payments").select("id").eq("order_id", arranged.orderId), "payments");
    expect(payments).toHaveLength(1);
    const logged = must(await db().from("webhook_events").select("status, attempts").eq("id", event.id).single(), "event log");
    expect(logged).toEqual({ status: "processed", attempts: 1 });
  });

  test("payment_intent.payment_failed keeps the order pending and records why", async ({ request }) => {
    const arranged = await arrangePendingOrder({ userId, pay: "pm_card_chargeDeclined" });
    expect(arranged.intent.status).toBe("requires_payment_method");

    const response = await deliver(request, fixtureEvent("payment_intent.payment_failed", arranged.intent));
    expect(response.status).toBe(200);

    expect((await orderRow(arranged.orderId)).status).toBe("pending_payment");
    const payment = await paymentRow(arranged.intent.id);
    expect(payment.status).toBe("failed");
    expect(payment.failure_code).toBe("generic_decline");
    expect(payment.failure_message).toMatch(/declined/i);
  });

  test("payment_intent.canceled cancels a pending order", async ({ request }) => {
    const arranged = await arrangePendingOrder({ userId });
    const canceled = await stripe().paymentIntents.cancel(arranged.intent.id);

    const response = await deliver(request, fixtureEvent("payment_intent.canceled", canceled));
    expect(response.status).toBe(200);

    const order = await orderRow(arranged.orderId);
    expect(order.status).toBe("cancelled");
    expect(order.cancellation_reason).toBe("The payment was cancelled before it completed.");
    expect((await paymentRow(arranged.intent.id)).status).toBe("cancelled");
  });

  test("charge.refunded records partial and full refunds", async ({ request }) => {
    const arranged = await arrangePendingOrder({ userId, totalCents: 900, pay: "pm_card_visa" });
    await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent));
    const chargeId = arranged.intent.latest_charge as string;

    // Partial, as if from the Stripe dashboard.
    const partial = await stripe().refunds.create({ payment_intent: arranged.intent.id, amount: 200 });
    let response = await deliver(request, fixtureEvent("charge.refunded", await stripe().charges.retrieve(chargeId)));
    expect(response.status).toBe(200);

    let payment = await paymentRow(arranged.intent.id);
    expect(payment).toMatchObject({ status: "partially_refunded", refunded_cents: 200 });
    expect((await orderRow(arranged.orderId)).status).toBe("placed");
    const recorded = must(
      await db().from("refunds").select("amount_cents, status, reason").eq("provider_refund_id", partial.id).single(),
      "refund row",
    );
    expect(recorded).toEqual({ amount_cents: 200, status: "succeeded", reason: "Refunded outside the app" });

    // The rest.
    await stripe().refunds.create({ payment_intent: arranged.intent.id });
    response = await deliver(request, fixtureEvent("charge.refunded", await stripe().charges.retrieve(chargeId)));
    expect(response.status).toBe(200);

    payment = await paymentRow(arranged.intent.id);
    expect(payment).toMatchObject({ status: "refunded", refunded_cents: 900 });
    expect((await orderRow(arranged.orderId)).status).toBe("refunded");
  });

  test("an amount that doesn't match the order is flagged, not placed", async ({ request }) => {
    const arranged = await arrangePendingOrder({ userId, totalCents: 1000, intentAmountCents: 900, pay: "pm_card_visa" });

    const response = await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent));
    expect(response.status).toBe(200);

    const order = await orderRow(arranged.orderId);
    expect(order.status).toBe("pending_payment");
    expect(order.flagged_for_review_at).not.toBeNull();
    expect(order.review_reason).toMatch(/900/);
  });

  test("events out of order: a late failure never undoes a success", async ({ request }) => {
    // Declined first, then paid with another card: two real states of one intent.
    const arranged = await arrangePendingOrder({ userId, pay: "pm_card_chargeDeclined" });
    const failedIntent = arranged.intent;
    const succeededIntent = await stripe().paymentIntents.confirm(failedIntent.id, { payment_method: "pm_card_visa" });
    expect(succeededIntent.status).toBe("succeeded");

    await deliver(request, fixtureEvent("payment_intent.succeeded", succeededIntent));
    await deliver(request, fixtureEvent("payment_intent.payment_failed", failedIntent));
    await deliver(request, fixtureEvent("payment_intent.canceled", { ...succeededIntent, status: "canceled" }));

    expect((await orderRow(arranged.orderId)).status).toBe("placed");
    expect((await paymentRow(failedIntent.id)).status).toBe("succeeded");
  });

  test("a payment that lands after the location paused is refunded and the order cancelled", async ({ request }) => {
    await setPaused(SEEDED.cafeSlug, true);
    try {
      const arranged = await arrangePendingOrder({ userId, totalCents: 750, pay: "pm_card_visa" });

      const response = await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent));
      expect(response.status).toBe(200);

      // Cancelled, then Refunded once the money is back; the reason stays for the customer.
      const order = await orderRow(arranged.orderId);
      expect(order.status).toBe("refunded");
      expect(order.cancellation_reason).toMatch(/paused online orders.*refunded in full/);

      const refunds = must(await db().from("refunds").select("amount_cents, status").eq("order_id", arranged.orderId), "refunds");
      expect(refunds).toEqual([{ amount_cents: 750, status: "succeeded" }]);
      const stripeRefunds = await stripe().refunds.list({ payment_intent: arranged.intent.id });
      expect(stripeRefunds.data.map((r) => r.amount)).toEqual([750]);
    } finally {
      await setPaused(SEEDED.cafeSlug, false);
    }
  });
});

test.describe("pending order expiry", () => {
  test("needs the cron secret", async ({ request }) => {
    expect((await request.get("/api/cron/expire-orders")).status()).toBe(401);
    const wrong = await request.get("/api/cron/expire-orders", { headers: { authorization: "Bearer nope" } });
    expect(wrong.status()).toBe(401);
  });

  test("cancels stale unpaid orders and their PaymentIntents", async ({ request }) => {
    const stale = await arrangePendingOrder({ userId });
    const fresh = await arrangePendingOrder({ userId });
    must(
      await db()
        .from("orders")
        .update({ created_at: new Date(Date.now() - 45 * 60_000).toISOString() })
        .eq("id", stale.orderId)
        .select()
        .single(),
      "age the order",
    );

    const response = await request.get("/api/cron/expire-orders", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(response.status()).toBe(200);
    expect((await response.json()).expired).toBeGreaterThanOrEqual(1);

    const order = await orderRow(stale.orderId);
    expect(order.status).toBe("cancelled");
    expect(order.cancellation_reason).toBe("Checkout expired before the payment was completed.");
    expect((await stripe().paymentIntents.retrieve(stale.intent.id)).status).toBe("canceled");

    expect((await orderRow(fresh.orderId)).status).toBe("pending_payment");
    expect((await stripe().paymentIntents.retrieve(fresh.intent.id)).status).toBe("requires_payment_method");
  });
});

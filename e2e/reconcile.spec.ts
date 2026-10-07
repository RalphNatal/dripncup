/**
 * The reconcile fallback for orders: with no webhook delivered at all, the
 * confirmation page asks the server to read the payment from Stripe, and
 * the order is placed exactly as the webhook would have placed it.
 */
import { expect, test } from "./support/test";

import { signIn } from "./support/checkout";
import { createCustomer, db, must } from "./support/db";
import { arrangePendingOrder, orderRow } from "./support/stripe";

test("an order paid while the webhook is down is placed by the reconcile fallback", async ({ page }) => {
  const user = await createCustomer("reconcile");
  const arranged = await arrangePendingOrder({ userId: user.id, pay: "pm_card_visa" });
  expect(arranged.intent.status).toBe("succeeded");

  await signIn(page, user.email, user.password, "/orders");
  await page.goto(`/orders/${arranged.orderId}/confirmed?redirect_status=succeeded`);
  await expect(page.getByText("Confirming your payment…")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Mahalo!/ })).toBeVisible({ timeout: 40_000 });

  expect((await orderRow(arranged.orderId)).status).toBe("placed");
  const payment = must(await db().from("payments").select("status, provider_charge_id").eq("provider_payment_intent_id", arranged.intent.id).single(), "payment");
  expect(payment.status).toBe("succeeded");
  expect(payment.provider_charge_id).toMatch(/^ch_/);
  // No webhook event was involved.
  const events = must(await db().from("webhook_events").select("id"), "webhook events");
  expect(events.some((e) => e.id.includes(arranged.intent.id))).toBe(false);
});

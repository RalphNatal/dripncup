/**
 * Cart and checkout in the browser, paying with Stripe's test cards in the
 * sandbox. After Stripe redirects back, the test delivers the real
 * payment_intent.succeeded event to the test server (see support/stripe.ts),
 * which is what turns the order Placed.
 */
import { expect, test } from "./support/test";

import {
  CARDS,
  addFromMenu,
  answer3ds,
  fillCard,
  orderIdFromUrl,
  payButton,
  paymentIntentFromUrl,
  signIn,
  waitForCheckout,
} from "./support/checkout";
import { SEEDED, createCustomer, db, must } from "./support/db";
import { setPaused } from "./support/storefront";
import { arrangePendingOrder, deliver, fixtureEvent, orderRow, relayRealEvent, stripe } from "./support/stripe";
import { cartLink } from "./support/ui";

test.describe.configure({ timeout: 120_000 });

async function ordersFor(userId: string) {
  return must(await db().from("orders").select("id, status, order_number").eq("user_id", userId), "orders for user");
}

test.describe("checkout", () => {
  test("pays by card and the order is placed", async ({ page, request, browser }) => {
    const since = Date.now();
    const user = await createCustomer("pay");
    await signIn(page, user.email, user.password);
    await addFromMenu(page, "Latte");

    await page.goto("/cart");
    await page.getByRole("link", { name: /^Checkout/ }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await waitForCheckout(page);
    await expect(page.getByLabel("Name for your cup")).toHaveValue("Kai");
    await expect(page.getByText(/Ready around \d{1,2}:\d{2} [AP]M/)).toBeVisible();
    const total = await page.getByTestId("order-total").innerText();
    await expect(payButton(page)).toHaveText(`Pay ${total}`);

    await fillCard(page, CARDS.visa);
    await payButton(page).click();

    const intent = await paymentIntentFromUrl(page);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(page.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });

    const orderId = orderIdFromUrl(page);
    const [order] = await ordersFor(user.id);
    expect(order).toMatchObject({ id: orderId, status: "placed" });
    await expect(page.getByTestId("order-number")).toHaveText(order.order_number);
    await expect(page.getByTestId("order-total")).toHaveText(total);
    await expect(page.getByText("1× Latte")).toBeVisible();

    // The cart empties once the order is Placed.
    await expect(cartLink(page)).toHaveAccessibleName("Cart, empty");

    // Nobody else can open the confirmation page.
    const stranger = await createCustomer("stranger");
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    await signIn(other, stranger.email, stranger.password);
    const response = await other.goto(`/orders/${orderId}/confirmed`);
    expect(response?.status()).toBe(404);
    await otherContext.close();
  });

  test("3-D Secure card: authenticates, then the order is placed", async ({ page, request }) => {
    const since = Date.now();
    const user = await createCustomer("3ds");
    await signIn(page, user.email, user.password);
    await addFromMenu(page, "Latte");
    await page.goto("/checkout");
    await waitForCheckout(page);

    await fillCard(page, CARDS.threeDSecure);
    await payButton(page).click();
    await answer3ds(page, "Complete");

    const intent = await paymentIntentFromUrl(page);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(page.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });
    expect((await ordersFor(user.id)).map((o) => o.status)).toEqual(["placed"]);
  });

  test("a declined card can be retried on the same order", async ({ page, request }) => {
    const since = Date.now();
    const user = await createCustomer("declined");
    await signIn(page, user.email, user.password);
    await addFromMenu(page, "Latte");
    await page.goto("/checkout");
    await waitForCheckout(page);

    await fillCard(page, CARDS.declined);
    await payButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /declined/i })).toBeVisible({ timeout: 30_000 });
    await expect(payButton(page)).toBeEnabled();
    const pending = await ordersFor(user.id);
    expect(pending.map((o) => o.status)).toEqual(["pending_payment"]);

    await fillCard(page, CARDS.visa);
    await payButton(page).click();
    const intent = await paymentIntentFromUrl(page);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(page.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });

    // Same order, same PaymentIntent.
    const orders = await ordersFor(user.id);
    expect(orders).toEqual([expect.objectContaining({ id: pending[0].id, status: "placed" })]);
    const payments = must(await db().from("payments").select("provider_payment_intent_id").eq("order_id", pending[0].id), "payments");
    expect(payments).toEqual([{ provider_payment_intent_id: intent }]);
  });

  test("double-clicking Pay makes one order", async ({ page, request }) => {
    const since = Date.now();
    const user = await createCustomer("double");
    await signIn(page, user.email, user.password);
    await addFromMenu(page, "Latte");
    await page.goto("/checkout");
    await waitForCheckout(page);

    await fillCard(page, CARDS.visa);
    await payButton(page).dblclick();

    const intent = await paymentIntentFromUrl(page);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(page.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });
    expect(await ordersFor(user.id)).toHaveLength(1);
  });

  test("promo codes: a valid one applies, others get the generic message", async ({ page }) => {
    const user = await createCustomer("promo");
    await signIn(page, user.email, user.password);
    await addFromMenu(page, "Latte", 2); // $11.50
    await page.goto("/checkout");
    await waitForCheckout(page);

    const code = page.getByLabel("Promo code");
    const apply = page.getByRole("button", { name: "Apply" });
    const refusal = page.getByRole("alert").filter({ hasText: "This code can't be applied." });

    await code.fill("NOPE123");
    await apply.click();
    await expect(refusal).toBeVisible();

    // Expired reads exactly like never existed.
    await code.fill("SPRING24");
    await apply.click();
    await expect(refusal).toBeVisible();

    // The one reason that is spelled out: a minimum spend.
    await code.fill("ALOHA5");
    await apply.click();
    await expect(page.getByRole("alert").filter({ hasText: "Spend $25.00 or more to use this code." })).toBeVisible();

    await code.fill("mahalo10");
    await apply.click();
    await expect(page.getByText("MAHALO10 applied")).toBeVisible();
    await expect(page.getByText("Promo (MAHALO10)")).toBeVisible();
    await expect(page.getByText("−$1.15").first()).toBeVisible();
    await expect(payButton(page)).toBeEnabled();
  });

  test("a price change in the database shows on the cart", async ({ page }) => {
    await addFromMenu(page, "Banana Bread");
    const product = must(await db().from("products").select("id, base_price_cents").eq("slug", "banana-bread").single(), "banana bread");
    await db().from("products").update({ base_price_cents: product.base_price_cents + 50 }).eq("id", product.id);
    try {
      await page.goto("/cart");
      await expect(page.getByText(/Price updated: \$4\.50\s*→\s*\$5\.00 each/)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Banana Bread" })).toBeVisible();
      await expect(page.getByText("Subtotal").locator("..")).toContainText("$5.00");
    } finally {
      await db().from("products").update({ base_price_cents: product.base_price_cents }).eq("id", product.id);
    }
  });

  test("Edit on a cart line changes it in place", async ({ page }) => {
    await addFromMenu(page, "Latte");
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Latte" })).toBeVisible();

    await page.getByRole("button", { name: "Edit Latte" }).click();
    const sheet = page.getByRole("dialog", { name: "Latte" });
    await sheet.getByRole("radio", { name: /^Large/ }).check();
    await sheet.getByRole("button", { name: "Update item · $6.50" }).click();
    await expect(sheet).toBeHidden();

    const items = page.getByRole("list", { name: "Items in your cart" }).getByRole("listitem");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText("Large");
    await expect(items.first()).toContainText("$6.50");
  });

  test("a paused location blocks checkout", async ({ page }) => {
    const user = await createCustomer("paused");
    await signIn(page, user.email, user.password);
    await addFromMenu(page, "Latte");
    await setPaused(SEEDED.cafeSlug, true);
    try {
      await page.goto("/cart");
      await expect(page.getByText("Checkout isn't available right now")).toBeVisible();
      await expect(page.getByRole("button", { name: "Checkout" })).toBeDisabled();

      await page.goto("/checkout");
      await expect(page.getByText(/paused online orders/).first()).toBeVisible({ timeout: 20_000 });
      await expect(payButton(page)).toBeDisabled();
    } finally {
      await setPaused(SEEDED.cafeSlug, false);
    }
    expect(await ordersFor(user.id)).toHaveLength(0);
  });

  test("a guest signs in at checkout and keeps their cart", async ({ page }) => {
    const user = await createCustomer("guest");
    await addFromMenu(page, "Latte");
    await page.goto("/cart");
    await page.getByRole("link", { name: "Sign in to check out" }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=(%2F|\/)checkout$/);

    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByText("1× Latte")).toBeVisible();
    await waitForCheckout(page);
  });

  test("a failed payment can be retried from the confirmation page", async ({ page, request }) => {
    const since = Date.now();
    const user = await createCustomer("retry");
    const arranged = await arrangePendingOrder({ userId: user.id, pay: "pm_card_chargeDeclined" });
    await deliver(request, fixtureEvent("payment_intent.payment_failed", arranged.intent));

    await signIn(page, user.email, user.password);
    await page.goto(`/orders/${arranged.orderId}/confirmed`);
    await expect(page.getByRole("heading", { name: "Your payment didn't go through" })).toBeVisible();
    await page.getByRole("button", { name: "Try paying again" }).click();

    await fillCard(page, CARDS.visa);
    await page.getByRole("button", { name: /^Pay \$/ }).click();

    const intent = await paymentIntentFromUrl(page);
    expect(intent).toBe(arranged.intent.id);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(page.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });
    expect((await orderRow(arranged.orderId)).status).toBe("placed");
  });
});

test.describe("account deletion with money on the table", () => {
  test("a paid, unfinished order is refunded before the account goes", async ({ page, request }) => {
    const user = await createCustomer("delete-paid");
    const arranged = await arrangePendingOrder({ userId: user.id, totalCents: 830, pay: "pm_card_visa" });
    await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent));
    expect((await orderRow(arranged.orderId)).status).toBe("placed");

    await signIn(page, user.email, user.password, "/account/delete");
    await page.getByLabel("Your password", { exact: true }).fill(user.password);
    await page.getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);

    const refunds = must(
      await db().from("refunds").select("amount_cents, status, reason").eq("order_id", arranged.orderId),
      "refunds",
    );
    expect(refunds).toEqual([{ amount_cents: 830, status: "succeeded", reason: "Customer closed their account" }]);
    const stripeRefunds = await stripe().refunds.list({ payment_intent: arranged.intent.id });
    expect(stripeRefunds.data.map((r) => r.amount)).toEqual([830]);

    const order = must(await db().from("orders").select("status, user_id").eq("id", arranged.orderId).single(), "order");
    expect(order).toEqual({ status: "refunded", user_id: null });
  });
});

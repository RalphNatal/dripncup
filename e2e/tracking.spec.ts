/**
 * Phase 5: live order tracking, the active-order card, emails, reorder and
 * favourites.
 *
 * Status changes are made the way the staff dashboard will make them: the
 * seeded barista, signed in, calling advance_order_status (or POSTing to the
 * cancel-with-refund endpoint). The customer's page is never reloaded while
 * it waits; a marker set on `window` proves it.
 */
import { expect, test, type Page } from "./support/test";

import { signIn } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, createCustomer, db, must } from "./support/db";
import {
  BARISTA,
  advance,
  arrangePlacedOrder,
  closeClients,
  forceStatus,
  mailBody,
  mailTo,
  signedInClient,
  waitForMail,
  watchOrder,
} from "./support/orders";
import { markSoldOut } from "./support/storefront";
import { arrangePendingOrder, deliver, fixtureEvent } from "./support/stripe";

const CRON_SECRET = process.env.E2E_CRON_SECRET!;

const LATTE = {
  productSlug: "latte",
  sizeName: "Medium",
  options: [
    { groupSlug: "temperature", name: "Hot" },
    { groupSlug: "milk", name: "Oat milk" },
  ],
};

/** Marks the page so a later check can prove it was never reloaded. */
async function markPage(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
}

async function expectNotReloaded(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

test.afterAll(async () => {
  await closeClients();
});

test.describe("live order tracking", () => {
  test("the tracker follows the barista without a reload, and Ready raises the alert", async ({ page }) => {
    const user = await createCustomer("tracker");
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const barista = await signedInClient(BARISTA);

    await signIn(page, user.email, user.password, `/orders/${orderId}`);
    await expect(page.getByTestId("order-number")).toHaveText(orderNumber);
    await expect(page.getByTestId("order-status").first()).toHaveText("Placed");
    await expect(page.getByText("Live updates on")).toBeVisible({ timeout: 15_000 });
    await markPage(page);

    await advance(barista, orderId, "accepted");
    await expect(page.getByTestId("order-status").first()).toHaveText("Accepted");
    await advance(barista, orderId, "preparing");
    await expect(page.getByTestId("order-status").first()).toHaveText("Preparing");
    await expect(page.getByRole("listitem").filter({ hasText: "Preparing" }).first()).toHaveAttribute("aria-current", "step");

    await advance(barista, orderId, "ready");
    const banner = page.getByTestId("ready-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Your order is ready at Drincup Cafe");
    await expect(page).toHaveTitle(/Ready!/);

    await advance(barista, orderId, "picked_up");
    await expect(page.getByTestId("order-status").first()).toHaveText("Picked up");
    await expect(banner).toBeHidden();
    await expect(page).not.toHaveTitle(/Ready!/);
    await expectNotReloaded(page);

    // The history shows each step with who made it.
    const history = must(
      await db().from("order_status_history").select("to_status, changed_by").eq("order_id", orderId).order("created_at"),
      "history",
    );
    const baristaId = (await barista.auth.getUser()).data.user!.id;
    expect(history.filter((h) => h.changed_by === baristaId).map((h) => h.to_status)).toEqual([
      "accepted",
      "preparing",
      "ready",
      "picked_up",
    ]);
  });

  test("another customer can't open the order or receive its realtime updates", async ({ page }) => {
    const owner = await createCustomer("rt-owner");
    const stranger = await createCustomer("rt-stranger");
    const { orderId } = await arrangePlacedOrder({ userId: owner.id, lines: [LATTE] });

    await signIn(page, stranger.email, stranger.password, "/");
    const response = await page.goto(`/orders/${orderId}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("We couldn't find that page")).toBeVisible();

    // Both subscribe to the same order over a real Realtime socket.
    const ownerEvents = await watchOrder(await signedInClient(owner.email), orderId);
    const strangerEvents = await watchOrder(await signedInClient(stranger.email), orderId);

    await advance(await signedInClient(BARISTA), orderId, "accepted");
    await expect.poll(() => ownerEvents.slice(), { timeout: 15_000 }).toContain("accepted");
    // Give a leak every chance to arrive before concluding it didn't.
    await page.waitForTimeout(3000);
    expect(strangerEvents).toEqual([]);
  });

  test("Home shows the active order card, and it updates live", async ({ page }) => {
    const user = await createCustomer("home-card");
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });

    await signIn(page, user.email, user.password, "/");
    const card = page.getByTestId("active-order-card").filter({ hasText: orderNumber });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("order-status")).toHaveText("Placed");
    await expect(page.locator("[data-testid=orders-dot]:visible")).toHaveCount(1);
    await markPage(page);
    // Let the shared subscription join before the change.
    await page.waitForTimeout(1500);

    const barista = await signedInClient(BARISTA);
    await advance(barista, orderId, "accepted");
    await expect(card.getByTestId("order-status")).toHaveText("Accepted");
    await advance(barista, orderId, "preparing");
    await advance(barista, orderId, "ready");
    await expect(card.getByTestId("order-status")).toHaveText("Ready");
    await expect(card).toContainText("Ready now");

    await advance(barista, orderId, "picked_up");
    await expect(card).toBeHidden();
    await expect(page.locator("[data-testid=orders-dot]:visible")).toHaveCount(0);
    await expectNotReloaded(page);
  });

  test("cancelling a paid order refunds it; the tracker shows Refunded with the reason", async ({ page, browser, request, baseURL }) => {
    const user = await createCustomer("cancel-refund");
    const arranged = await arrangePendingOrder({ userId: user.id, pay: "pm_card_visa" });
    expect((await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent))).body.outcome).toBe("processed");

    await signIn(page, user.email, user.password, `/orders/${arranged.orderId}`);
    await expect(page.getByTestId("order-status").first()).toHaveText("Placed");
    await expect(page.getByText("Live updates on")).toBeVisible({ timeout: 15_000 });
    await markPage(page);

    // The barista cancels through the cancel-with-refund endpoint.
    const staff = await browser.newContext();
    try {
      const staffPage = await staff.newPage();
      await signIn(staffPage, BARISTA, TEST_PASSWORD, "/");
      const response = await staff.request.post(`/api/staff/orders/${arranged.orderId}/cancel`, {
        data: { reason: "Out of oat milk" },
        headers: { origin: baseURL! },
      });
      expect(response.status()).toBe(200);
      expect((await response.json()).refund).toMatchObject({ ok: true, status: "succeeded", amountCents: arranged.totalCents });
    } finally {
      await staff.close();
    }

    await expect(page.getByTestId("order-status").first()).toHaveText("Refunded");
    const outcome = page.getByTestId("order-outcome");
    await expect(outcome).toContainText("Order refunded");
    await expect(outcome).toContainText("The cafe cancelled it: Out of oat milk.");
    await expect(outcome).toContainText("We refunded $6.12 to your Visa •••• 4242");
    await expectNotReloaded(page);

    // A paid order can't be cancelled the other way.
    const paid = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const { error } = await (await signedInClient(BARISTA)).rpc("advance_order_status", {
      p_order_id: paid.orderId,
      p_new_status: "cancelled",
      p_reason: "Out of oat milk",
    });
    expect(error?.code).toBe("DC002");

    // And the customer is told by email.
    const messages = await waitForMail(user.email, 1);
    expect(messages.some((m) => /was cancelled/.test(m.Subject))).toBe(true);
  });
});

test.describe("receipt email", () => {
  test("arrives in Mailpit with the right totals, once, however often the webhook is replayed", async ({ request }) => {
    const user = await createCustomer("receipt");
    const arranged = await arrangePendingOrder({ userId: user.id, totalCents: 1080, pay: "pm_card_visa" });
    const event = fixtureEvent("payment_intent.succeeded", arranged.intent);

    expect((await deliver(request, event)).body.outcome).toBe("processed");
    const [message] = await waitForMail(user.email, 1);
    expect(message.Subject).toBe(`Your Drincup Cafe receipt · ${arranged.orderNumber}`);
    const body = await mailBody(message.ID);
    expect(body.Text).toContain(`Order ${arranged.orderNumber}`);
    expect(body.Text).toContain("Total: $10.80");
    expect(body.Text).toContain("Tax (GET 0%): $0.00");
    expect(body.Text).toContain("Paid with Visa •••• 4242");
    expect(body.Text).toContain(`/orders/${arranged.orderId}`);
    expect(body.HTML).toContain("$10.80");

    // The same event again, and a second event for the same payment.
    expect((await deliver(request, event)).body.outcome).toBe("duplicate");
    expect((await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent))).body.outcome).toBe("processed");
    const sweep = await request.get("/api/cron/send-emails", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(sweep.status()).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(await mailTo(user.email)).toHaveLength(1);
    const outbox = must(await db().from("email_outbox").select("kind, status").eq("order_id", arranged.orderId), "outbox");
    expect(outbox).toEqual([{ kind: "order_receipt", status: "sent" }]);
  });
});

test.describe("order again", () => {
  test("skips what is sold out and adds the rest at today's prices", async ({ page }) => {
    const user = await createCustomer("reorder");
    // The latte cost 25¢ less back then; the cookie is sold out today.
    const { orderId } = await arrangePlacedOrder({
      userId: user.id,
      lines: [{ ...LATTE, unitPriceCents: 630 }, { productSlug: "macadamia-cookie" }],
    });
    await forceStatus(orderId, ["accepted", "preparing", "ready", "picked_up"]);
    const restock = await markSoldOut(SEEDED.cafeSlug, { productSlug: "macadamia-cookie" });

    try {
      await signIn(page, user.email, user.password, `/orders/${orderId}`);
      await page.getByRole("button", { name: "Order again" }).click();
      const dialog = page.getByRole("dialog", { name: "Order again" });

      const latte = dialog.getByTestId("reorder-line").filter({ hasText: "Latte" });
      await expect(latte).toHaveAttribute("data-status", "price_changed");
      await expect(latte).toContainText("Price changed: $6.30 → $6.55 each");

      const cookie = dialog.getByTestId("reorder-line").filter({ hasText: "Macadamia Nut Cookie" });
      await expect(cookie).toHaveAttribute("data-status", "unavailable");
      await expect(cookie).toContainText("Skipped.");
      await expect(cookie).toContainText("Sold out at");

      await dialog.getByRole("button", { name: "Add 1 item to cart" }).click();
      await page.waitForURL("**/cart");
      const items = page.getByRole("list", { name: "Items in your cart" }).getByRole("listitem");
      await expect(items).toHaveCount(1);
      await expect(items.first()).toContainText("Latte");
      await expect(items.first()).toContainText("Oat milk");
      await expect(items.first()).toContainText("$6.55");
    } finally {
      await restock();
    }
  });
});

test.describe("favorites", () => {
  test("save from the product sheet, rename, add to the cart, delete", async ({ page }) => {
    const user = await createCustomer("favorites");
    await signIn(page, user.email, user.password, "/menu");

    await page.getByRole("link", { name: "Latte", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Latte" });
    await sheet.getByRole("radio", { name: /^Oat milk/ }).check();
    await sheet.getByRole("button", { name: "Save as favorite" }).click();
    const name = sheet.getByLabel("Favorite name");
    await expect(name).toHaveValue("Latte");
    await name.fill("My usual");
    await sheet.getByRole("button", { name: "Save favorite" }).click();
    await expect(page.getByText("Saved “My usual” to your favorites")).toBeVisible();

    await page.goto("/account/favorites");
    const card = page.getByTestId("favorite-card").filter({ hasText: "My usual" });
    await expect(card).toContainText("Oat milk");

    await card.getByRole("button", { name: "Rename My usual" }).click();
    await card.getByLabel("Favorite name").fill("Morning latte");
    await card.getByRole("button", { name: "Save name" }).click();
    const renamed = page.getByTestId("favorite-card").filter({ hasText: "Morning latte" });
    await expect(renamed).toBeVisible();

    await renamed.getByRole("button", { name: "Add Morning latte to cart" }).click();
    await expect(page.getByText(/Added “Morning latte” to your cart/)).toBeVisible();
    await expect(page.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();

    await renamed.getByRole("button", { name: "Delete Morning latte" }).click();
    await renamed.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("No favorites yet")).toBeVisible();

    const left = must(await db().from("favorites").select("id").eq("user_id", user.id), "favorites");
    expect(left).toHaveLength(0);
  });
});

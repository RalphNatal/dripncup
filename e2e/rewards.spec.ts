/**
 * Phase 7: Overflow Rewards in the browser.
 *
 * Points are given with admin_adjust_points (as an admin would from Studio).
 * Orders are either checked out for real in the browser (paying in the
 * Stripe sandbox and delivering the real webhook) or arranged through the
 * same SQL functions checkout uses, and moved along by the seeded barista
 * through advance_order_status, exactly as the staff screen does.
 */
import { expect, test, type Browser, type Page } from "./support/test";

import { CARDS, addFromMenu, fillCard, orderIdFromUrl, payButton, paymentIntentFromUrl, signIn, waitForCheckout } from "./support/checkout";
import { createCustomer, db, must } from "./support/db";
import { BARISTA, advance, arrangePlacedOrder, closeClients, signedInClient } from "./support/orders";
import { openStaffQueue, ticket } from "./support/staff";
import { arrangePendingOrder, deliver, fixtureEvent, relayRealEvent, stripe } from "./support/stripe";

const CRON_SECRET = process.env.E2E_CRON_SECRET!;

test.describe.configure({ timeout: 150_000 });

test.afterAll(async () => {
  await closeClients();
});

async function givePoints(userId: string, points: number) {
  must(await db().rpc("admin_adjust_points", { p_user_id: userId, p_points: points, p_reason: "e2e test points" }), "give points");
}

async function balanceOf(userId: string) {
  return must(await db().from("profiles").select("loyalty_points").eq("id", userId).single(), "balance").loyalty_points;
}

async function reservationOf(orderId: string) {
  return must(await db().from("loyalty_reservations").select("status").eq("order_id", orderId).single(), "reservation").status;
}

async function pickUp(orderId: string) {
  const barista = await signedInClient(BARISTA);
  for (const status of ["accepted", "preparing", "ready", "picked_up"] as const) await advance(barista, orderId, status);
}

function rewardOption(page: Page, name: string) {
  return page.locator(`[data-testid=reward-option][data-reward="${name}"]`);
}

async function applyReward(page: Page, name: string) {
  await page.getByRole("button", { name: `Use ${name}` }).click();
  await expect(rewardOption(page, name)).toHaveAttribute("data-state", "applied");
}

/** Signed in, a cart, on /checkout with the quote and card form loaded. */
async function openCheckoutWith(page: Page, user: { email: string; password: string }, products: string[]) {
  await signIn(page, user.email, user.password);
  for (const product of products) await addFromMenu(page, product);
  await page.goto("/checkout");
  await waitForCheckout(page);
}

test.describe("Overflow Rewards", () => {
  test("guests see how the programme works and are invited to join", async ({ page }) => {
    await page.goto("/rewards");
    await expect(page.getByRole("link", { name: "Join for free" })).toBeVisible();
    await expect(page.getByTestId("reward-tier")).toHaveCount(3);
    const how = page.getByTestId("how-it-works");
    await expect(how).toContainText("1 point for every $1");
    await expect(how).toContainText("never expire");
    await expect(how).toContainText("can't be combined with a promo code");
  });

  test("an order picked up earns points that appear on Rewards and Home", async ({ page }) => {
    const user = await createCustomer("earn");
    const { orderId, orderNumber } = await arrangePlacedOrder({
      userId: user.id,
      lines: [{ productSlug: "latte", sizeName: "Medium", options: [{ groupSlug: "milk", name: "Whole milk" }] }],
      pointsEarned: 5,
    });

    await signIn(page, user.email, user.password, "/rewards");
    await expect(page.getByTestId("points-balance")).toContainText("0");

    await pickUp(orderId);
    await page.reload();
    await expect(page.getByTestId("points-balance")).toHaveText(/^5\s*points$/);
    await expect(page.getByTestId("points-progress")).toHaveText("45 points to Free add-on");
    const earned = page.locator("[data-testid=activity-entry][data-kind=earned]");
    await expect(earned).toContainText("+5 points");
    await expect(earned.getByRole("link", { name: `Order ${orderNumber}` })).toHaveAttribute("href", `/orders/${orderId}`);

    await page.goto("/");
    await expect(page.getByTestId("home-rewards").getByTestId("points-balance")).toHaveText(/^5\s*points$/);
  });

  test("a free drink at checkout: server-priced total, receipt, staff ticket, points spent on payment", async ({ page, request, browser }) => {
    const since = Date.now();
    const user = await createCustomer("redeem");
    await givePoints(user.id, 200);
    await openCheckoutWith(page, user, ["Latte", "Macadamia Nut Cookie"]);

    await expect(page.getByTestId("checkout-balance")).toHaveText("200 points");
    await applyReward(page, "Free drink");
    await expect(page.getByTestId("reward-row")).toHaveText("Free drink: Latte−$5.75");
    // $3.75 cookie + GET 4.712% ($0.18) + 18% tip on $3.75 ($0.68), all from the server.
    await expect(page.getByTestId("order-total")).toHaveText("$4.61");
    await expect(page.getByTestId("points-note")).toHaveText("You'll earn 3 points when you pick this up.");
    await expect(payButton(page)).toHaveText("Pay $4.61");

    await fillCard(page, CARDS.visa);
    await payButton(page).click();
    const intent = await paymentIntentFromUrl(page);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(page.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });
    const orderId = orderIdFromUrl(page);

    // The confirmation shows the reward on the line and in the totals.
    await expect(page.getByTestId("line-reward")).toHaveText("Free drink");
    await expect(page.getByTestId("reward-row")).toHaveText("Free drink: Latte−$5.75");
    await expect(page.getByTestId("points-note")).toContainText("3 points");

    const order = must(
      await db().from("orders").select("order_number, total_cents, reward_discount_cents, points_earned, points_redeemed").eq("id", orderId).single(),
      "order",
    );
    expect(order).toMatchObject({ total_cents: 461, reward_discount_cents: 575, points_earned: 3, points_redeemed: 150 });
    expect(await reservationOf(orderId)).toBe("redeemed");
    expect(await balanceOf(user.id)).toBe(50);

    await page.goto("/rewards");
    await expect(page.locator("[data-testid=activity-entry][data-kind=redeemed]")).toContainText("−150 points");

    // The barista's ticket says the latte is a reward.
    const staff = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    try {
      const staffPage = await staff.newPage();
      await openStaffQueue(staffPage, BARISTA);
      const card = ticket(staffPage, order.order_number);
      await expect(card.getByTestId("ticket-reward")).toHaveText("REWARD · Free drink");
      await expect(card.getByTestId("ticket-item").filter({ hasText: "Latte" }).getByTestId("ticket-reward")).toBeVisible();
    } finally {
      await staff.close();
    }
  });

  test("a checkout with a reward that is never paid gives the points back when it expires", async ({ page, request }) => {
    const user = await createCustomer("expire");
    await givePoints(user.id, 150);
    await openCheckoutWith(page, user, ["Latte", "Macadamia Nut Cookie"]);
    await applyReward(page, "Free drink");

    await fillCard(page, CARDS.declined);
    await payButton(page).click();
    await expect(page.getByRole("alert").filter({ hasText: /declined/i })).toBeVisible({ timeout: 30_000 });
    // The reward stays on the order for a retry: this checkout holds the points.
    await expect(rewardOption(page, "Free drink")).toHaveAttribute("data-state", "applied");
    const [pending] = must(await db().from("orders").select("id").eq("user_id", user.id), "orders");
    expect(await reservationOf(pending.id)).toBe("held");
    expect(await balanceOf(user.id)).toBe(0);

    await page.goto("/rewards");
    await expect(page.getByText("150 points held by an unfinished checkout")).toBeVisible();
    await expect(page.locator("[data-testid=activity-entry][data-kind=reserved]")).toContainText("held until the order is paid");

    // Past the expiry age, the job cancels it.
    must(
      await db().from("orders").update({ created_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString() }).eq("id", pending.id).select().single(),
      "age the checkout",
    );
    const response = await request.get("/api/cron/expire-orders", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(response.status()).toBe(200);

    expect(await reservationOf(pending.id)).toBe("released");
    await page.reload();
    await expect(page.getByTestId("points-balance")).toHaveText(/^150\s*points$/);
    await expect(page.locator("[data-testid=activity-entry][data-kind=returned]")).toContainText("+150 points");
  });

  test("two sessions spending the same points at once: only one succeeds", async ({ browser }) => {
    const user = await createCustomer("race");
    await givePoints(user.id, 150);

    async function session(b: Browser) {
      const context = await b.newContext();
      const page = await context.newPage();
      await openCheckoutWith(page, user, ["Latte"]);
      await applyReward(page, "Free drink");
      // The reward covers the whole $5.75 latte: nothing to pay.
      const place = page.getByRole("button", { name: "Place order · $0.00" });
      await expect(place).toBeEnabled();
      return { context, page, place };
    }
    const [a, b] = await Promise.all([session(browser), session(browser)]);

    await Promise.all([a.place.click(), b.place.click()]);
    const outcome = async (page: Page) =>
      Promise.race([
        page.getByRole("heading", { name: "Mahalo!" }).waitFor({ timeout: 30_000 }).then(() => "placed"),
        page
          .getByTestId("reward-notice")
          .filter({ hasText: "You don't have enough points for that reward any more." })
          .waitFor({ timeout: 30_000 })
          .then(() => "refused"),
      ]);
    const results = await Promise.all([outcome(a.page), outcome(b.page)]);
    expect([...results].sort()).toEqual(["placed", "refused"]);

    // The loser keeps the explanation, and the reward is off their order.
    const loser = results[0] === "refused" ? a.page : b.page;
    await expect(loser.getByTestId("reward-row")).toHaveCount(0);
    await expect(rewardOption(loser, "Free drink")).toHaveAttribute("data-state", "unavailable");

    const orders = must(await db().from("orders").select("status").eq("user_id", user.id), "orders");
    expect(orders.map((o) => o.status)).toEqual(["placed"]);
    expect(await balanceOf(user.id)).toBe(0);
    await a.context.close();
    await b.context.close();
  });

  test("one discount per order: a reward swaps the promo out, and back, with a message", async ({ page }) => {
    const user = await createCustomer("swap");
    await givePoints(user.id, 200);
    await openCheckoutWith(page, user, ["Latte", "Latte"]);

    await page.getByLabel("Promo code").fill("MAHALO10");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("MAHALO10 applied")).toBeVisible();

    await applyReward(page, "Free drink");
    await expect(page.getByTestId("reward-notice")).toHaveText(
      "We took off promo code MAHALO10: a promo code and a reward can't be used on the same order.",
    );
    await expect(page.getByText("MAHALO10 applied")).toBeHidden();
    await expect(page.getByTestId("reward-row")).toHaveText("Free drink: Latte−$5.75");
    await expect(page.getByText(/^Promo \(/)).toHaveCount(0);

    await page.getByLabel("Promo code").fill("MAHALO10");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("MAHALO10 applied")).toBeVisible();
    await expect(page.getByTestId("reward-notice")).toContainText("We took off Free drink");
    await expect(page.getByTestId("reward-row")).toHaveCount(0);
    await expect(rewardOption(page, "Free drink")).toHaveAttribute("data-state", "available");
  });

  test("refunds after pickup reverse the earned points; a full refund returns the redeemed ones", async ({ page, request }) => {
    const user = await createCustomer("refund");
    await givePoints(user.id, 150);
    const arranged = await arrangePendingOrder({
      userId: user.id,
      totalCents: 612,
      pay: "pm_card_visa",
      pointsEarned: 6,
      reward: { name: "Free drink", discountCents: 575 },
    });
    expect((await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent))).body.outcome).toBe("processed");
    expect(await reservationOf(arranged.orderId)).toBe("redeemed");
    await pickUp(arranged.orderId);
    expect(await balanceOf(user.id)).toBe(6);

    const chargeId = String(arranged.intent.latest_charge);
    // Half refunded: half the points (3 of 6) come back off; the reward stays spent.
    await stripe().refunds.create({ payment_intent: arranged.intent.id, amount: 306 });
    expect((await deliver(request, fixtureEvent("charge.refunded", await stripe().charges.retrieve(chargeId)))).status).toBe(200);
    expect(await balanceOf(user.id)).toBe(3);
    expect(await reservationOf(arranged.orderId)).toBe("redeemed");

    // The rest: every earned point reversed, and the 150 spent on the reward returned.
    await stripe().refunds.create({ payment_intent: arranged.intent.id });
    expect((await deliver(request, fixtureEvent("charge.refunded", await stripe().charges.retrieve(chargeId)))).status).toBe(200);
    expect(await balanceOf(user.id)).toBe(150);
    expect(await reservationOf(arranged.orderId)).toBe("released");

    await signIn(page, user.email, user.password, "/rewards");
    await expect(page.getByTestId("points-balance")).toHaveText(/^150\s*points$/);
    const reversed = page.locator("[data-testid=activity-entry][data-kind=reversed]");
    await expect(reversed).toHaveCount(2);
    await expect(page.locator("[data-testid=activity-entry][data-kind=returned]")).toContainText("+150 points");
  });

  test("the member QR shows the code, and regenerating replaces it", async ({ page }) => {
    const user = await createCustomer("qr");
    const before = must(await db().from("profiles").select("member_code").eq("id", user.id).single(), "code").member_code;

    await signIn(page, user.email, user.password, "/rewards");
    await expect(page.getByTestId("member-qr")).toHaveAttribute("data-value", before);
    await expect(page.getByTestId("member-code")).toHaveText(before.replace(/(.{4})(?=.)/g, "$1 "));

    await page.getByRole("button", { name: "Regenerate code" }).click();
    await page.getByRole("button", { name: "Yes, new code" }).click();
    await expect(page.getByText("New code ready. Your old one no longer works.")).toBeVisible();

    const after = must(await db().from("profiles").select("member_code").eq("id", user.id).single(), "code").member_code;
    expect(after).not.toBe(before);
    await expect(page.getByTestId("member-qr")).toHaveAttribute("data-value", after);

    await page.goto("/account");
    await expect(page.getByTestId("member-qr")).toHaveAttribute("data-value", after);
  });
});

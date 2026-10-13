/**
 * Phase 9: running the cafe -- hours and closures the storefront follows,
 * promo codes, points adjustments and refunds, through the admin screens.
 */
import { expect, test } from "./support/test";

import { expectToast, honoluluWeekday, signInAdmin } from "./support/admin";
import { honoluluAt, honoluluDate, resetClock, setClock } from "./support/catering";
import { CARDS, addFromMenu, clickPay, fillCard, paymentIntentFromUrl, signIn, waitForCheckout } from "./support/checkout";
import { createCustomer, db, must } from "./support/db";
import { makeCafeAlwaysOpen } from "./support/storefront";
import { arrangePendingOrder, deliver, fixtureEvent, relayRealEvent, stripe } from "./support/stripe";

test.describe.configure({ timeout: 150_000 });

test.describe("hours and closures", () => {
  test.afterEach(async () => {
    await makeCafeAlwaysOpen();
    await db().from("closures").delete().not("id", "is", null);
  });

  test("weekly hours and a closure set the customer's status and pickup times", async ({ page, browser }) => {
    const weekday = honoluluWeekday(1);
    const customer = await createCustomer("hours");
    const context = await browser.newContext();
    const shopper = await context.newPage();
    // A cart built while open, tomorrow at 9 AM (the e2e clock; test mode is off).
    await setClock(context, honoluluAt(1, "09:00"));
    await signIn(shopper, customer.email, customer.password);
    await addFromMenu(shopper, "Latte");

    // Tomorrow becomes 10 AM - 2 PM.
    await signInAdmin(page, "/admin/locations");
    const day = page.getByTestId(`hours-${weekday}`);
    await day.getByRole("button", { name: new RegExp(`^Remove ${weekday}`) }).click();
    await day.getByRole("button", { name: `Open on ${weekday}` }).click();
    await day.getByLabel(`${weekday} opens`).fill("10:00");
    await day.getByLabel(`${weekday} closes`).fill("14:00");
    await page.getByRole("button", { name: "Save weekly hours" }).click();
    await expectToast(page, "Weekly hours saved. They apply now.");

    // At 9 AM tomorrow the cafe is closed until 10; checkout offers 10:00 onwards.
    await shopper.goto("/menu");
    await expect(shopper.getByText("Closed · Opens 10:00 AM").first()).toBeVisible();
    await shopper.goto("/checkout");
    await waitForCheckout(shopper);
    await expect(shopper.getByText("We're closed right now. Choose a pickup time.")).toBeVisible();
    const slots = shopper.locator("select").last();
    await expect(slots.locator("option:not([disabled])").first()).toHaveText(/10:00 AM/);

    // A closure tomorrow: closed all day.
    await page.getByRole("button", { name: "Add closure" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Date (Honolulu)").fill(honoluluDate(1));
    await dialog.getByLabel("Reason").fill("E2E staff day");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expectToast(page, "Closure saved.");
    await expect(page.getByTestId("closure-list")).toContainText("E2E staff day");

    await shopper.goto("/menu");
    await expect(shopper.getByText(/Closed · Opens \w{3} /).first()).toBeVisible();
    await expect(shopper.getByText("Closed · Opens 10:00 AM")).toHaveCount(0);
    await resetClock(context);
    await context.close();
  });
});

test.describe("promotions", () => {
  test("a code created here works at checkout, and is locked once used", async ({ page, request, browser }) => {
    const code = `E2E${Date.now().toString(36).toUpperCase()}`;
    await signInAdmin(page, "/admin/promos/new");
    await page.getByLabel("Code", { exact: true }).fill(code.toLowerCase());
    await page.getByLabel("Percent off (%)").fill("10");
    await page.getByRole("button", { name: "Create promo" }).click();
    await expectToast(page, "Promo created.");
    await expect(page).toHaveURL(/\/admin\/promos\/[0-9a-f-]{36}$/);
    const promoUrl = page.url();
    await expect(page.getByLabel("Code", { exact: true })).toHaveValue(code);

    // A customer pays with it (the code typed in lower case).
    const since = Date.now();
    const customer = await createCustomer("promo");
    const context = await browser.newContext();
    const shopper = await context.newPage();
    await signIn(shopper, customer.email, customer.password);
    await addFromMenu(shopper, "Latte");
    await shopper.goto("/checkout");
    await waitForCheckout(shopper);
    await shopper.getByLabel("Promo code").fill(code.toLowerCase());
    await shopper.getByRole("button", { name: "Apply" }).click();
    await expect(shopper.getByText(`Promo (${code})`)).toBeVisible();
    await fillCard(shopper, CARDS.visa);
    await clickPay(shopper);
    const intent = await paymentIntentFromUrl(shopper);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(shopper.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });
    await context.close();

    await page.goto(promoUrl);
    await expect(page.getByTestId("promo-locked")).toBeVisible();
    await expect(page.getByLabel("Code", { exact: true })).toBeDisabled();
    await expect(page.getByLabel("Percent off (%)")).toBeDisabled();
    await expect(page.getByLabel("Orders that used this code").getByText("Kai").first()).toBeVisible();
    // Dates and limits still change.
    await page.getByLabel("Total uses").fill("50");
    await page.getByRole("button", { name: "Save promo" }).click();
    await expectToast(page, "Promo saved.");
  });
});

test.describe("rewards", () => {
  test("adjusting a member's points updates the balance and the activity log", async ({ page }) => {
    const member = await createCustomer("points");
    const code = must(await db().from("profiles").select("member_code").eq("id", member.id).single(), "code").member_code;
    await signInAdmin(page, "/admin/rewards/members");
    await page.getByRole("searchbox").fill(code);
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: "Kai E2E" }).first().click();
    await expect(page.getByTestId("member-balance")).toHaveText("0 points");

    const form = page.getByTestId("adjust-points");
    await form.getByLabel("Points").fill("75");
    await form.getByLabel("Reason").fill("E2E goodwill");
    await form.getByRole("button", { name: "Adjust" }).click();
    await expectToast(page, "Added 75 points.");
    await expect(page.getByTestId("member-balance")).toHaveText("75 points");
    await expect(page.getByTestId("member-activity")).toContainText("“E2E goodwill”");

    // A reason is required.
    await form.getByLabel("Points").fill("-20");
    await form.getByRole("button", { name: "Adjust" }).click();
    await expect(form.getByText("A reason is required")).toBeVisible();
    await form.getByLabel("Reason").fill("E2E correction");
    await form.getByRole("button", { name: "Adjust" }).click();
    await expect(page.getByTestId("member-balance")).toHaveText("55 points");
  });
});

test.describe("orders", () => {
  test("cancel with a partial refund from the order page; the customer sees it", async ({ page, request, browser }) => {
    const customer = await createCustomer("partial");
    const arranged = await arrangePendingOrder({ userId: customer.id, totalCents: 1000, pay: "pm_card_visa" });
    expect((await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent))).body.outcome).toBe("processed");

    await signInAdmin(page, "/admin/orders");
    await page.getByRole("searchbox").fill(arranged.orderNumber);
    await page.getByRole("button", { name: "Find orders" }).click();
    await page.getByRole("link", { name: arranged.orderNumber }).first().click();
    await expect(page.getByTestId("order-status")).toHaveText("Placed");

    await page.getByRole("button", { name: "Cancel with refund" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("refunded to the customer's card");
    await dialog.getByLabel("Amount to refund ($)").fill("4.00");
    await dialog.getByLabel("Reason").fill("Out of oat milk, kept the pastry");
    await dialog.getByRole("button", { name: "Cancel and refund" }).click();
    await expectToast(page, "Cancelled and refunded $4.00.");
    await expect(page.getByTestId("order-status")).toHaveText("Cancelled");
    await expect(page.getByTestId("order-refunds")).toContainText("$4.00");

    const refunds = must(await db().from("refunds").select("amount_cents, status").eq("order_id", arranged.orderId), "refunds");
    expect(refunds).toEqual([{ amount_cents: 400, status: "succeeded" }]);
    const intent = await stripe().paymentIntents.retrieve(arranged.intent.id, { expand: ["latest_charge"] });
    expect((intent.latest_charge as { amount_refunded: number }).amount_refunded).toBe(400);

    const context = await browser.newContext();
    const owner = await context.newPage();
    await signIn(owner, customer.email, customer.password, `/orders/${arranged.orderId}`);
    await expect(owner.getByText(/We refunded \$4\.00/)).toBeVisible();
    await context.close();
  });
});

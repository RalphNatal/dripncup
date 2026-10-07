/**
 * Phase 8: catering, end to end.
 *
 *   - a request inside the lead time is refused; outside it gets a number,
 *     and the customer and the admin are emailed
 *   - admin quotes -> customer is emailed -> asks for changes -> admin
 *     revises -> customer pays with 4242 -> confirmed, receipt emailed, and
 *     on the event day (controllable clock) the staff prep list shows it
 *   - an expired quote can't be paid
 *   - admin cancels a paid request with a partial refund: refund recorded,
 *     customer emailed
 *   - the reconcile fallback confirms a payment with no webhook at all
 *   - one customer cannot open another's request or pay for it
 */
import { expect, test, type Page } from "./support/test";

import {
  ADMIN_NOTIFICATION_EMAIL,
  arrangeCateringRequest,
  arrangeConfirmedCatering,
  arrangeQuote,
  cateringRow,
  honoluluDate,
  latestCateringIntent,
  setClock,
} from "./support/catering";
import { CARDS, cardFrame, fillCard, signIn } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, createCustomer, db, must } from "./support/db";
import { BARISTA, mailBody, mailTo } from "./support/orders";
import { openStaffQueue } from "./support/staff";
import { relayRealEvent } from "./support/stripe";

async function waitForMailWithSubject(address: string, subject: string, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = (await mailTo(address)).find((m) => m.Subject.includes(subject));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email to ${address} with subject containing "${subject}" within ${timeoutMs / 1000}s`);
}

async function payWithCard(page: Page) {
  await cardFrame(page);
  await fillCard(page, CARDS.visa);
  // Stripe's Link section can slide open just after the card is typed and
  // move the button from under a click; click again until it takes (the
  // page ignores a second submit while one is in flight).
  const pay = page.getByRole("button", { name: /^Pay \$/ });
  await expect(async () => {
    if (await pay.isVisible()) await pay.click({ timeout: 2000 });
    await expect(pay).toBeHidden({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}

test.describe("catering", () => {
  test("inside the lead time is refused; outside it the request gets a number and both sides are emailed", async ({ page }) => {
    const user = await createCustomer("cat-new");
    await signIn(page, user.email, user.password, "/catering");

    await page.getByLabel("Date").fill(honoluluDate(1));
    await page.getByLabel("Start time").fill("11:00");
    await page.getByLabel("How many guests?").fill("20");
    await page.getByLabel("Add a drink").selectOption({ label: "Cold Brew" });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("catering-item")).toHaveCount(1);
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText(/too soon/i).first()).toBeVisible();
    await expect(page.getByTestId("catering-confirmation")).toHaveCount(0);

    await page.getByLabel("Date").fill(honoluluDate(5));
    await page.getByRole("button", { name: "Send request" }).click();
    const confirmation = page.getByTestId("catering-confirmation");
    await expect(confirmation).toBeVisible();
    const number = (await page.getByTestId("catering-request-number").textContent())!.trim();
    expect(number).toMatch(/^CAT-\d{6}-\d{3}$/);
    await expect(confirmation.getByText("What happens next")).toBeVisible();

    const received = await waitForMailWithSubject(user.email, `We got your catering request · ${number}`);
    expect((await mailBody(received.ID)).Text).toContain("What happens next");
    await waitForMailWithSubject(ADMIN_NOTIFICATION_EMAIL, `New catering request · ${number}`);

    // It is listed under My catering.
    await page.goto("/account/catering");
    await expect(page.getByTestId("my-catering")).toContainText(number);
  });

  test("quote, changes, revised quote, pay with 4242: confirmed, receipts, and the prep list on the day @tablet", async ({ browser, request }) => {
    const customer = await createCustomer("cat-flow");
    const arranged = await arrangeCateringRequest({ userId: customer.id, email: customer.email });

    // The admin builds the first quote from what was asked for.
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, SEEDED.admin, TEST_PASSWORD, "/admin");
    await admin.goto(`/admin/catering/${arranged.id}`);
    const builder = admin.getByTestId("quote-builder");
    await expect(builder.getByTestId("quote-line")).toHaveCount(2);
    await builder.getByLabel("Line 2 description").fill("Signature drink: Lilikoʻi Sunrise");
    await builder.getByLabel("Line 2 unit price in dollars").fill("6.50");
    await expect(builder.getByTestId("quote-preview")).toContainText("Total");
    await builder.getByRole("button", { name: "Send quote" }).click();
    await expect(admin.getByText(/Quote v1 sent/)).toBeVisible();
    await waitForMailWithSubject(customer.email, `Your catering quote · ${arranged.number}`);

    // The customer asks for changes.
    const customerContext = await browser.newContext();
    const page = await customerContext.newPage();
    await signIn(page, customer.email, customer.password, `/account/catering/${arranged.id}`);
    await expect(page.getByTestId("quote-summary")).toContainText("Signature drink: Lilikoʻi Sunrise");
    await page.getByRole("button", { name: "Request changes" }).click();
    await page.getByLabel("Your changes").fill("Could half of the cold brew be with oat milk?");
    await page.getByRole("button", { name: "Send to the cafe" }).click();
    await expect(page.getByRole("heading", { name: "We're preparing your quote." })).toBeVisible();
    await waitForMailWithSubject(ADMIN_NOTIFICATION_EMAIL, `Changes requested on a catering quote · ${arranged.number}`);

    // The admin revises it; both versions are kept.
    await admin.reload();
    await expect(admin.getByRole("heading", { name: "Revise the quote" })).toBeVisible();
    await admin.getByTestId("quote-builder").getByLabel("Line 1 unit price in dollars").fill("5.00");
    await admin.getByRole("button", { name: "Send revised quote" }).click();
    await expect(admin.getByText(/Quote v2 sent/)).toBeVisible();
    await expect(admin.getByTestId("quote-version")).toHaveCount(2);
    await waitForMailWithSubject(customer.email, `Your revised catering quote · ${arranged.number}`);

    // The customer pays the revised quote with 4242; the webhook confirms it.
    await page.reload();
    await page.getByRole("link", { name: "Accept & pay" }).click();
    await expect(page).toHaveURL(new RegExp(`/catering/${arranged.id}/pay`));
    const since = Date.now();
    await payWithCard(page);
    const intent = await latestCateringIntent(arranged.id);
    const delivery = await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    expect(delivery.status).toBe(200);
    await expect(page.getByTestId("catering-paid")).toBeVisible({ timeout: 30_000 });
    expect((await cateringRow(arranged.id)).status).toBe("confirmed");

    const receipt = await waitForMailWithSubject(customer.email, `You're confirmed! Catering receipt · ${arranged.number}`);
    const receiptText = (await mailBody(receipt.ID)).Text;
    expect(receiptText).toContain("Signature drink: Lilikoʻi Sunrise");
    expect(receiptText).toContain("Visa •••• 4242");
    await waitForMailWithSubject(ADMIN_NOTIFICATION_EMAIL, `Catering payment received · ${arranged.number}`);

    // The barista's prep list: not today, but there on the event day.
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    await openStaffQueue(staff, BARISTA);
    await staff.getByRole("button", { name: /^Catering/ }).click();
    await expect(staff.getByTestId("catering-list")).not.toContainText(arranged.number);

    await setClock(staffContext, new Date(arranged.eventAt.getTime() - 3 * 60 * 60_000));
    await staff.reload();
    await staff.getByRole("button", { name: "Start shift" }).click();
    await staff.getByRole("button", { name: /^Catering/ }).click();
    const prep = staff.getByTestId("catering-request").filter({ hasText: arranged.number });
    await expect(prep).toBeVisible();
    await expect(prep).toContainText("Signature drink: Lilikoʻi Sunrise");
    await expect(prep).toContainText("Cold Brew");

    await Promise.all([adminContext.close(), customerContext.close(), staffContext.close()]);
  });

  test("an expired quote can't be paid", async ({ page }) => {
    const user = await createCustomer("cat-expired");
    const arranged = await arrangeCateringRequest({ userId: user.id, email: user.email });
    await arrangeQuote(arranged.id, { expiresAt: new Date(Date.now() + 60 * 60_000) });

    await signIn(page, user.email, user.password, `/account/catering/${arranged.id}`);
    await expect(page.getByRole("link", { name: "Accept & pay" })).toBeVisible();

    // Two hours later the quote has expired.
    await setClock(page.context(), new Date(Date.now() + 2 * 60 * 60_000));
    await page.reload();
    await expect(page.getByText("This quote has expired.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Accept & pay" })).toHaveCount(0);

    await page.goto(`/catering/${arranged.id}/pay`);
    await expect(page.getByTestId("catering-pay-blocked")).toContainText("expired");
    expect(await db().from("payments").select("id").eq("catering_request_id", arranged.id).then((r) => r.data?.length)).toBe(0);
  });

  test("an admin cancels a paid request with a partial refund: refund recorded, customer emailed", async ({ page }) => {
    const user = await createCustomer("cat-refund");
    const confirmed = await arrangeConfirmedCatering(user, 9000);

    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/admin");
    await page.goto(`/admin/catering/${confirmed.id}`);
    await page.getByRole("button", { name: "Cancel and refund" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason (the customer sees it)").fill("Our van is out of service that day, sorry!");
    await dialog.getByLabel("Partial refund").check();
    await dialog.getByLabel("Amount to refund ($)").fill("10.00");
    await dialog.getByRole("button", { name: "Cancel and refund" }).click();
    await expect(page.getByText("Cancelled and refunded $10.00.")).toBeVisible();

    expect((await cateringRow(confirmed.id)).status).toBe("cancelled");
    const refunds = must(await db().from("refunds").select("amount_cents, status").eq("catering_request_id", confirmed.id), "refunds");
    expect(refunds).toEqual([{ amount_cents: 1000, status: "succeeded" }]);
    const payment = must(await db().from("payments").select("refunded_cents, status").eq("provider_payment_intent_id", confirmed.intentId).single(), "payment");
    expect(payment).toEqual({ refunded_cents: 1000, status: "partially_refunded" });

    const email = await waitForMailWithSubject(user.email, `Catering request ${confirmed.number} was cancelled`);
    const text = (await mailBody(email.ID)).Text;
    expect(text).toContain("Our van is out of service that day");
    expect(text).toContain("We've refunded $10.00 of the $90.00 you paid");
  });

  test("with no webhook at all, the reconcile fallback confirms the payment", async ({ page }) => {
    const user = await createCustomer("cat-reconcile");
    const arranged = await arrangeCateringRequest({ userId: user.id, email: user.email });
    await arrangeQuote(arranged.id, { totalCents: 4200 });

    await signIn(page, user.email, user.password, `/catering/${arranged.id}/pay`);
    await payWithCard(page);
    await expect(page.getByTestId("catering-paid")).toBeVisible({ timeout: 40_000 });
    expect((await cateringRow(arranged.id)).status).toBe("confirmed");

    // Nothing came through the webhook: no event was recorded for it.
    const intent = await latestCateringIntent(arranged.id);
    const stripeEvents = must(await db().from("webhook_events").select("id, type"), "webhook events");
    expect(stripeEvents.filter((e) => e.id.includes(intent))).toEqual([]);
  });

  test("one customer can't open or pay another's request", async ({ page }) => {
    const owner = await createCustomer("cat-owner");
    const arranged = await arrangeCateringRequest({ userId: owner.id, email: owner.email });
    await arrangeQuote(arranged.id);

    const other = await createCustomer("cat-other");
    await signIn(page, other.email, other.password, "/account");
    for (const path of [`/account/catering/${arranged.id}`, `/catering/${arranged.id}/pay`]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
    }
    expect(await db().from("payments").select("id").eq("catering_request_id", arranged.id).then((r) => r.data?.length)).toBe(0);
  });
});

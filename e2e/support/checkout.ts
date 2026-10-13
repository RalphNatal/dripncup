/**
 * Browser steps for checkout: signing in, filling the Stripe Payment Element
 * (it lives in Stripe's iframes), and answering the 3-D Secure test page.
 */
import { expect, type Frame, type Page } from "@playwright/test";

import { addToCartButton, openFromMenu } from "./ui";

/** Stripe's test cards. */
export const CARDS = {
  visa: "4242 4242 4242 4242",
  threeDSecure: "4000 0025 0000 3155",
  declined: "4000 0000 0000 0002",
} as const;

export async function signIn(page: Page, email: string, password: string, next = "/menu") {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === next);
}

export async function addFromMenu(page: Page, productName: string, quantity = 1) {
  await page.goto("/menu");
  const sheet = await openFromMenu(page, productName);
  for (let i = 1; i < quantity; i++) await sheet.getByRole("button", { name: "Increase Quantity" }).click();
  await addToCartButton(sheet).click();
  await expect(sheet).toBeHidden();
}

export function payButton(page: Page) {
  return page.getByRole("button", { name: /^Pay \$|^Processing/ });
}

/**
 * The Stripe iframe holding the card form. Found by what it contains: Stripe
 * renders several iframes and their titles change between loads.
 */
export async function cardFrame(page: Page, timeoutMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith("https://js.stripe.com/")) continue;
      if (await frame.locator('input[name="number"]').isVisible().catch(() => false)) return frame;
    }
    await page.waitForTimeout(250);
  }
  throw new Error("Stripe's card form never appeared");
}

/** Checkout has loaded its quote and Stripe's card form. */
export async function waitForCheckout(page: Page) {
  await expect(page.getByTestId("order-total")).toBeVisible({ timeout: 20_000 });
  await cardFrame(page);
}

export async function fillCard(page: Page, number: string) {
  const frame = await cardFrame(page);
  const card = frame.locator('input[name="number"]');
  await card.fill("");
  await card.pressSequentially(number.replace(/\s/g, ""), { delay: 10 });
  await frame.locator('input[name="expiry"]').fill("12 / 34");
  await frame.locator('input[name="cvc"]').fill("123");
  // Only shown when the country is one with postal codes (depends on where the browser is).
  const postal = frame.locator('input[name="postalCode"]');
  if (await postal.isVisible()) await postal.fill("96814");
}

/** Clicks Complete (or Fail) on Stripe's 3-D Secure test page, wherever it is nested. */
export async function answer3ds(page: Page, action: "Complete" | "Fail" = "Complete") {
  const selector = action === "Complete" ? "#test-source-authorize-3ds" : "#test-source-fail-3ds";
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const frame = page.frames().find((f) => f.url().startsWith("https://testmode-acs.stripe.com/"));
    const button = frame?.locator(selector);
    if (button && (await button.isVisible().catch(() => false))) {
      // The challenge slides in; a click during the animation can be lost.
      await page.waitForTimeout(1000);
      await button.click().catch(() => undefined);
      await page.waitForTimeout(2000);
      if (!frame!.isDetached() && (await button.isVisible().catch(() => false))) continue;
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("The 3-D Secure challenge never appeared (or never closed)");
}

/** On the confirmation page after Stripe's redirect: the PaymentIntent in the URL. */
export async function paymentIntentFromUrl(page: Page): Promise<string> {
  await page.waitForURL(/\/orders\/[0-9a-f-]+\/confirmed\?.*payment_intent=/, { timeout: 45_000 });
  const intent = new URL(page.url()).searchParams.get("payment_intent");
  if (!intent) throw new Error(`No payment_intent in ${page.url()}`);
  return intent;
}

export function orderIdFromUrl(page: Page): string {
  const match = new URL(page.url()).pathname.match(/\/orders\/([0-9a-f-]+)\/confirmed/);
  if (!match) throw new Error(`Not a confirmation URL: ${page.url()}`);
  return match[1];
}

/**
 * Loads the main pages fresh (a full page load each, so each one hydrates)
 * as every kind of visitor, and lets the page guard (support/test.ts) fail
 * the test on any hydration mismatch, uncaught error or invalid nesting.
 *
 * Also pins down the Orders-tab dot: server-rendered from the same list the
 * client keeps live, shown for Placed through Ready only -- never for an
 * unpaid checkout.
 */
import { expect, test, type Page } from "./support/test";

import { arrangeCateringRequest, arrangeQuote } from "./support/catering";
import { addFromMenu, signIn } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, createCustomer, db, must } from "./support/db";
import { BARISTA, arrangePlacedOrder, forceStatus } from "./support/orders";
import { openStaffQueue } from "./support/staff";
import { arrangePendingOrder } from "./support/stripe";

const LATTE = { productSlug: "latte" };

/** A full load, then long enough for hydration and the first effects to run. */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** The dot as the server rendered it, before any script could touch it. */
async function dotsInServerHtml(page: Page, path: string): Promise<number> {
  const html = await (await page.request.get(path)).text();
  return (html.match(/data-testid="orders-dot"/g) ?? []).length;
}

const SHOP_PAGES = ["/", "/menu", "/menu/latte", "/rewards", "/orders", "/cart", "/account"];

test.describe("pages hydrate cleanly", () => {
  test("signed out", async ({ page }) => {
    for (const path of [
      "/",
      "/menu",
      "/menu/latte",
      "/rewards",
      "/cart",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/catering",
      "/events",
      `/events/${SEEDED.eventSlug}`,
      "/collections/summer-sunset",
    ]) {
      await visit(page, path);
    }
    await expect(page.locator("[data-testid=orders-dot]")).toHaveCount(0);
  });

  test("a customer with no orders", async ({ page }) => {
    const user = await createCustomer("health-none");
    await signIn(page, user.email, user.password, "/");
    for (const path of [...SHOP_PAGES, "/account/favorites", "/account/password", "/catering", "/account/catering", "/events"]) await visit(page, path);
    await expect(page.locator("[data-testid=orders-dot]")).toHaveCount(0);
  });

  test("a customer with an order in progress: the dot is server-rendered and hydrates as is", async ({ page }) => {
    const user = await createCustomer("health-active");
    const { orderId } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await signIn(page, user.email, user.password, "/");

    for (const path of [...SHOP_PAGES, `/orders/${orderId}`]) {
      await visit(page, path);
      await expect(page.locator("[data-testid=orders-dot]:visible")).toHaveCount(1);
    }
    // In the HTML itself: once in the bottom tabs, once in the desktop nav.
    expect(await dotsInServerHtml(page, "/")).toBe(2);
    expect(await dotsInServerHtml(page, "/menu")).toBe(2);

    // Ready: still one dot (the "ready" colour), still hydrating cleanly.
    await forceStatus(orderId, ["accepted", "preparing", "ready"]);
    await visit(page, "/");
    await expect(page.locator("[data-testid=orders-dot]:visible")).toHaveCount(1);
    await expect(page.getByText("(order ready)").first()).toBeAttached();

    // Picked up: gone.
    await forceStatus(orderId, ["picked_up"]);
    await visit(page, "/");
    await expect(page.locator("[data-testid=orders-dot]")).toHaveCount(0);
  });

  test("an unpaid checkout never shows the dot", async ({ page }) => {
    const user = await createCustomer("health-unpaid");
    await arrangePendingOrder({ userId: user.id });
    await signIn(page, user.email, user.password, "/");
    for (const path of ["/", "/orders"]) {
      await visit(page, path);
      await expect(page.locator("[data-testid=orders-dot]")).toHaveCount(0);
    }
    expect(await dotsInServerHtml(page, "/")).toBe(0);
  });

  test("a customer with items in the cart", async ({ page }) => {
    const user = await createCustomer("health-cart");
    await signIn(page, user.email, user.password, "/menu");
    await addFromMenu(page, "Latte", 2);
    for (const path of ["/", "/menu", "/cart", "/checkout", "/orders"]) {
      await visit(page, path);
      await expect(page.getByRole("link", { name: "Cart, 2 items" })).toBeVisible();
    }
  });

  test("the barista", async ({ page }) => {
    // Signs in, loads the server-rendered Start shift screen, starts the shift.
    await openStaffQueue(page, BARISTA);
    for (const path of ["/", "/menu", "/account"]) await visit(page, path);
  });

  test("a customer with a quoted catering request", async ({ page }) => {
    const user = await createCustomer("health-catering");
    const request = await arrangeCateringRequest({ userId: user.id, email: user.email });
    await arrangeQuote(request.id);
    await signIn(page, user.email, user.password, "/account/catering");
    for (const path of ["/account/catering", `/account/catering/${request.id}`, `/catering/${request.id}/pay`]) await visit(page, path);
  });

  test("the admin pages", async ({ page }) => {
    const user = await createCustomer("health-admin-catering");
    const request = await arrangeCateringRequest({ userId: user.id, email: user.email, fulfillment: "delivery" });
    const event = must(await db().from("locations").select("id").eq("slug", SEEDED.eventSlug).single(), "event");
    const collection = must(await db().from("collections").select("id").eq("slug", "summer-sunset").single(), "collection");
    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/admin");
    for (const path of [
      "/admin",
      "/admin/catering",
      "/admin/catering?status=new",
      "/admin/catering?view=calendar",
      "/admin/catering?view=calendar&mode=week",
      `/admin/catering/${request.id}`,
      "/admin/events",
      "/admin/events/new",
      `/admin/events/${event.id}`,
      "/admin/collections",
      "/admin/collections/new",
      `/admin/collections/${collection.id}`,
    ]) {
      await visit(page, path);
    }
  });

  test("the admin", async ({ page }) => {
    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/admin");
    for (const path of ["/admin", "/staff", "/", "/menu", "/rewards", "/account"]) await visit(page, path);
  });

  test("desktop navigation with an order in progress @desktop", async ({ page }) => {
    const user = await createCustomer("health-desktop");
    await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await signIn(page, user.email, user.password, "/");
    for (const path of ["/", "/menu", "/orders", "/rewards"]) {
      await visit(page, path);
      await expect(page.locator("[data-testid=orders-dot]:visible")).toHaveCount(1);
    }
  });
});

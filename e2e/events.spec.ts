/**
 * Phase 8: pop-up events, from the admin form to the customer.
 *
 *   - an admin creates an event (draft: invisible), publishes it: it shows on
 *     /events and Home; while it runs (controllable clock), "Order for pickup
 *     here" selects it and the menu shows only its items; after it ends, or
 *     once unpublished, it is gone, including from the location switcher
 *   - "Duplicate to another date" makes a correct copy
 */
import { expect, test, type Page } from "./support/test";

import { honoluluAt, honoluluDate, setClock } from "./support/catering";
import { signIn } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, db, must } from "./support/db";

async function createEventAsAdmin(admin: Page, name: string, date: string) {
  await admin.goto("/admin/events/new");
  await admin.getByLabel("Name", { exact: true }).fill(name);
  await admin.getByLabel("Date: date").fill(date);
  await admin.getByLabel("Starts").fill("10:00");
  await admin.getByLabel("Ends").fill("14:00");
  await admin.getByLabel("Address", { exact: true }).fill("1 Sample Pier, Honolulu");
  const search = admin.getByPlaceholder("Search the menu to add…");
  for (const product of ["Cold Brew", "POG Refresher"]) {
    await search.fill(product);
    await admin.getByRole("list", { name: "Matching products" }).getByRole("button", { name: new RegExp(product) }).click();
  }
  await expect(admin.getByTestId("picked-product")).toHaveCount(2);
  await admin.getByRole("button", { name: "Create event" }).click();
  await admin.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/);
  return admin.url().split("/").pop()!;
}

test.describe("pop-up events", () => {
  test("create, publish, live ordering, then hidden once past or unpublished", async ({ browser, page }) => {
    const name = `E2E Sunset Market ${Date.now().toString(36)}`;
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, SEEDED.admin, TEST_PASSWORD, "/admin");
    const eventId = await createEventAsAdmin(admin, name, honoluluDate(1));
    await expect(admin.getByTestId("event-publish-state")).toHaveText("Draft (not visible to customers)");

    // A draft is invisible.
    await page.goto("/events");
    await expect(page.getByText(name)).toHaveCount(0);

    await admin.getByRole("button", { name: "Publish" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
    await expect(admin.getByTestId("event-publish-state")).toHaveText("Published");
    const row = must(await db().from("locations").select("slug, created_by, updated_by").eq("id", eventId).single(), "event row");
    expect(row.created_by).not.toBeNull();
    expect(row.updated_by).not.toBeNull();

    // Published: on /events (coming up) and Home.
    await page.goto("/events");
    const card = page.getByTestId("event-card").filter({ hasText: name });
    await expect(card).toContainText("Coming up");
    await expect(card).toContainText("Cold Brew, POG Refresher");
    await expect(card.getByRole("button", { name: "Order for pickup here" })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByTestId("home-events")).toContainText(name);

    // While it runs: order for pickup here -> only its menu.
    await setClock(page.context(), honoluluAt(1, "11:00"));
    await page.goto("/events");
    const live = page.getByTestId("event-card").filter({ hasText: name });
    await expect(live).toContainText("Open now");
    await live.getByRole("button", { name: "Order for pickup here" }).click();
    await page.waitForURL("**/menu");
    await expect(page.getByText(`Pickup at ${name}`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Cold Brew", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "POG Refresher", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Latte", exact: true })).toHaveCount(0);

    // After it ends: gone from /events, and the menu falls back to the cafe.
    await setClock(page.context(), honoluluAt(1, "15:00"));
    await page.goto("/events");
    await expect(page.getByText(name)).toHaveCount(0);
    await page.goto("/menu");
    await expect(page.getByText(`Pickup at ${name}`)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Latte", exact: true })).toBeVisible();

    // Unpublished, even inside its window: gone.
    await setClock(page.context(), honoluluAt(1, "11:00"));
    await admin.getByRole("button", { name: "Unpublish" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Unpublish" }).click();
    await expect(admin.getByTestId("event-publish-state")).toHaveText("Draft (not visible to customers)");
    await page.goto("/events");
    await expect(page.getByText(name)).toHaveCount(0);
    expect((await page.goto(`/events/${row.slug}`))?.status()).toBe(404);

    await adminContext.close();
  });

  test("Duplicate to another date makes a correct copy", async ({ page }) => {
    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/admin");
    const eventId = await createEventAsAdmin(page, `E2E Weekend Fair ${Date.now().toString(36)}`, honoluluDate(3));
    const original = must(await db().from("locations").select("slug, starts_at, ends_at, prep_time_minutes, address_line1").eq("id", eventId).single(), "original");

    await page.getByRole("button", { name: "Duplicate to another date" }).click();
    await page.getByRole("dialog").getByLabel("New date (Honolulu)").fill(honoluluDate(4));
    await page.getByRole("dialog").getByRole("button", { name: "Duplicate" }).click();
    await page.waitForURL((url) => /\/admin\/events\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.endsWith(eventId));
    const copyId = page.url().split("/").pop()!;

    const copy = must(await db().from("locations").select("slug, starts_at, ends_at, prep_time_minutes, address_line1, is_published").eq("id", copyId).single(), "copy");
    const day = 24 * 60 * 60 * 1000;
    expect(Date.parse(copy.starts_at!) - Date.parse(original.starts_at!)).toBe(day);
    expect(Date.parse(copy.ends_at!) - Date.parse(original.ends_at!)).toBe(day);
    expect(copy.is_published).toBe(false);
    expect(copy.slug).toContain(honoluluDate(4));
    expect(copy.prep_time_minutes).toBe(original.prep_time_minutes);
    expect(copy.address_line1).toBe(original.address_line1);
    const menu = async (id: string) =>
      must(await db().from("event_menu_items").select("product_id, sort_order").eq("location_id", id).order("sort_order"), "menu").map((m) => m.product_id);
    expect(await menu(copyId)).toEqual(await menu(eventId));
    await expect(page.getByTestId("event-publish-state")).toHaveText("Draft (not visible to customers)");
  });
});

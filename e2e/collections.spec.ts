/**
 * Phase 8: a seasonal collection with a limited-time product, made in the
 * admin form, appears during its window and disappears after it
 * (controllable clock), on the menu and on its own page.
 */
import { expect, test } from "./support/test";

import { honoluluAt, honoluluDate, setClock } from "./support/catering";
import { signIn } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, db, must } from "./support/db";

const PRODUCT = "Matcha Latte";

test.describe("seasonal collections", () => {
  test.afterEach(async () => {
    // The product is shared seed data: give it back its open-ended availability.
    await db().from("products").update({ available_from: null, available_until: null }).eq("slug", "matcha-latte");
  });

  test("a collection with a limited-time product shows during its window and disappears after", async ({ browser, page }) => {
    const name = `E2E Fall Harvest ${Date.now().toString(36)}`;
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, SEEDED.admin, TEST_PASSWORD, "/admin");
    await admin.goto("/admin/collections/new");
    await admin.getByLabel("Name", { exact: true }).fill(name);
    await admin.getByLabel("Description").fill("Pumpkin, haupia and matcha for the cooler evenings.");
    await admin.getByLabel("Starts: date").fill(honoluluDate(1));
    await admin.getByLabel("Starts: time").fill("00:00");
    await admin.getByLabel("Ends: date").fill(honoluluDate(2));
    await admin.getByLabel("Ends: time").fill("00:00");

    // A bright accent: fine for decoration, flagged for text.
    await admin.getByLabel("Accent colour (optional)").fill("#1AB3C0");
    await expect(admin.getByTestId("accent-contrast-warning")).toContainText("2.54:1");

    await admin.getByPlaceholder("Search the menu to add…").fill(PRODUCT);
    await admin.getByRole("list", { name: "Matching products" }).getByRole("button", { name: new RegExp(PRODUCT) }).click();
    await admin.getByTestId("picked-product").getByLabel("Limited time").check();
    await expect(admin.getByTestId("collection-preview")).toContainText(name);
    await expect(admin.getByTestId("collection-preview")).toContainText(PRODUCT);
    await admin.getByRole("button", { name: "Create collection" }).click();
    await admin.waitForURL(/\/admin\/collections\/[0-9a-f-]{36}$/);
    const id = admin.url().split("/").pop()!;
    const saved = must(await db().from("collections").select("slug, created_by, accent_color").eq("id", id).single(), "collection");
    expect(saved.created_by).not.toBeNull();
    expect(saved.accent_color).toBe("#1AB3C0");

    // Before the window: neither the product nor the collection.
    await page.goto("/menu");
    await expect(page.getByRole("link", { name: PRODUCT, exact: true })).toHaveCount(0);
    expect((await page.goto(`/collections/${saved.slug}`))?.status()).toBe(404);

    // During it: the product is on the menu, and the collection takes the banner.
    await setClock(page.context(), honoluluAt(1, "12:00"));
    await page.goto("/menu");
    // Twice: its menu card, and a chip on the collection's banner.
    await expect(page.getByRole("link", { name: PRODUCT, exact: true })).toHaveCount(2);
    const banner = page.getByRole("region", { name });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("link", { name: PRODUCT, exact: true })).toBeVisible();
    await page.goto(`/collections/${saved.slug}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(page.getByRole("link", { name: PRODUCT, exact: true })).toBeVisible();

    // After it: gone from the menu; the collection page says it has ended.
    await setClock(page.context(), honoluluAt(3, "12:00"));
    await page.goto("/menu");
    await expect(page.getByRole("link", { name: PRODUCT, exact: true })).toHaveCount(0);
    await page.goto(`/collections/${saved.slug}`);
    await expect(page.getByText("This collection has ended")).toBeVisible();
    await expect(page.getByTestId("collection-ended-menu-link")).toHaveAttribute("href", "/menu");

    await adminContext.close();
  });
});

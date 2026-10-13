/**
 * Phase 9: the menu editor and the spreadsheet import, end to end -- what
 * the admin builds is what the customer sees, orders and pays for.
 */
import { devices, expect, test, type Page } from "./support/test";

import { expectToast, retireProduct, signInAdmin } from "./support/admin";
import { CARDS, clickPay, fillCard, paymentIntentFromUrl, signIn, waitForCheckout } from "./support/checkout";
import { createCustomer, db, must } from "./support/db";
import { arrangePlacedOrder, signedInClient } from "./support/orders";
import { relayRealEvent } from "./support/stripe";
import { addToCartButton, cartLink, openFromMenu } from "./support/ui";

test.describe.configure({ timeout: 150_000 });

const unique = () => Date.now().toString(36);

/** Fills the product editor's basics. */
async function startProduct(page: Page, name: string, slug: string) {
  await page.goto("/admin/menu/products/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Web address").fill(slug);
  await page.getByLabel("Category").selectOption({ label: "Coffee & Espresso" });
}

test.describe("product editor", () => {
  test("a product with sizes and a conditional group: preview, then a customer orders it @desktop", async ({ page, browser, request }) => {
    const slug = `e2e-iced-tea-${unique()}`;
    const name = `E2E Hibiscus Tea ${unique()}`;
    try {
      await signInAdmin(page, "/admin/menu/products/new");
      await startProduct(page, name, slug);
      await page.getByRole("button", { name: "Use sizes instead" }).click();
      const sizes = page.getByTestId("size-row");
      await sizes.nth(0).getByLabel("Size", { exact: true }).fill("Small");
      await sizes.nth(0).getByLabel("Price ($)").fill("4.00");
      await page.getByRole("button", { name: "Add a size" }).click();
      await sizes.nth(1).getByLabel("Size", { exact: true }).fill("Large");
      await sizes.nth(1).getByLabel("Price ($)").fill("5.25");

      await page.getByLabel("Add a group").selectOption({ label: "Hot or Iced (temperature)" });
      await page.getByRole("button", { name: "Add group" }).click();
      await page.getByLabel("Add a group").selectOption({ label: "Ice (ice-level)" });
      await page.getByRole("button", { name: "Add group" }).click();
      await page.getByTestId("linked-group").filter({ hasText: /^Ice/ }).getByLabel("Only show when").selectOption({ label: "Iced is selected" });

      // The preview is the customer's sheet: Hot by default, so Ice is hidden.
      const preview = page.getByTestId("product-preview");
      await expect(preview.getByRole("heading", { name })).toBeVisible();
      await expect(preview.getByRole("group", { name: /^Ice/ })).toHaveCount(0);
      await expect(addToCartButton(preview)).toHaveText("Add to Cart · $4.00");
      await preview.getByRole("radio", { name: /Large/ }).check();
      await preview.getByRole("radio", { name: /^Iced/ }).check();
      await expect(preview.getByRole("group", { name: /^Ice/ })).toBeVisible();
      await expect(addToCartButton(preview)).toHaveText("Add to Cart · $5.25");
      // A price typed in the editor shows in the preview at once.
      await sizes.nth(1).getByLabel("Price ($)").fill("5.50");
      await expect(addToCartButton(preview)).toHaveText("Add to Cart · $5.50");

      await page.getByRole("button", { name: "Create product" }).click();
      await expectToast(page, "Product created.");
      await expect(page).toHaveURL(/\/admin\/menu\/products\/[0-9a-f-]{36}$/);

      // The customer sees it the same way, and orders an iced large -- on a
      // phone, as every other card payment in the suite does (a desktop
      // profile paying by card draws Stripe's bot check).
      const since = Date.now();
      const customer = await createCustomer("new-product");
      const context = await browser.newContext({ ...devices["Pixel 7"] });
      const shopper = await context.newPage();
      await signIn(shopper, customer.email, customer.password);
      await shopper.goto("/menu");
      const sheet = await openFromMenu(shopper, name);
      await expect(sheet.getByRole("group", { name: /^Ice/ })).toHaveCount(0);
      await sheet.getByRole("radio", { name: /Large/ }).check();
      await sheet.getByRole("radio", { name: /^Iced/ }).check();
      await sheet.getByRole("radio", { name: /Light ice/ }).check();
      await expect(addToCartButton(sheet)).toHaveText("Add to Cart · $5.50");
      await addToCartButton(sheet).click();
      await expect(cartLink(shopper)).toHaveAccessibleName("Cart, 1 item");

      await shopper.goto("/checkout");
      await waitForCheckout(shopper);
      await fillCard(shopper, CARDS.visa);
      await clickPay(shopper);
      const intent = await paymentIntentFromUrl(shopper);
      await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
      await expect(shopper.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 20_000 });

      const line = must(
        await db().from("order_items").select("product_name, size_name, unit_price_cents, modifiers, order:orders!inner(user_id, status)").eq("order.user_id", customer.id).single(),
        "ordered line",
      );
      expect(line).toMatchObject({ product_name: name, size_name: "Large", unit_price_cents: 550 });
      expect((line.modifiers as { option_name: string }[]).map((m) => m.option_name)).toEqual(["Iced", "Light ice"]);
      await context.close();
    } finally {
      await retireProduct(slug);
    }
  });

  test("a price change reaches carts with a notice; a past order keeps its price", async ({ page, browser }) => {
    const slug = `e2e-scone-${unique()}`;
    const name = `E2E Scone ${unique()}`;
    try {
      await signInAdmin(page, "/admin/menu/products/new");
      await startProduct(page, name, slug);
      await page.getByLabel("Price", { exact: true }).fill("3.00");
      await page.getByRole("button", { name: "Create product" }).click();
      await expectToast(page, "Product created.");
      await expect(page).toHaveURL(/\/admin\/menu\/products\/[0-9a-f-]{36}$/);
      const productUrl = page.url();

      const customer = await createCustomer("price-change");
      const { orderId } = await arrangePlacedOrder({ userId: customer.id, lines: [{ productSlug: slug }] });
      const context = await browser.newContext();
      const shopper = await context.newPage();
      await signIn(shopper, customer.email, customer.password);
      await shopper.goto("/menu");
      const sheet = await openFromMenu(shopper, name);
      await addToCartButton(sheet).click();
      await expect(cartLink(shopper)).toHaveAccessibleName("Cart, 1 item");

      await page.goto(productUrl);
      await page.getByLabel("Price", { exact: true }).fill("3.50");
      await page.getByRole("button", { name: "Save product" }).click();
      await expectToast(page, /New carts and orders use these prices/);

      await shopper.goto("/cart");
      await expect(shopper.getByText(/Price updated: \$3\.00 → \$3\.50 each/)).toBeVisible();
      const past = must(await db().from("order_items").select("unit_price_cents").eq("order_id", orderId).single(), "past line");
      expect(past.unit_price_cents).toBe(300);
      await context.close();
    } finally {
      await retireProduct(slug);
    }
  });

  test("a product used by past orders is archived, not deleted", async ({ page }) => {
    const slug = `e2e-archive-${unique()}`;
    const name = `E2E Archive Me ${unique()}`;
    try {
      await signInAdmin(page, "/admin/menu/products/new");
      await startProduct(page, name, slug);
      await page.getByLabel("Price", { exact: true }).fill("2.75");
      await page.getByRole("button", { name: "Create product" }).click();
      await expectToast(page, "Product created.");
      await expect(page).toHaveURL(/\/admin\/menu\/products\/[0-9a-f-]{36}$/);
      const productUrl = page.url();
      const productId = productUrl.split("/").pop()!;

      const customer = await createCustomer("archive");
      const { orderId } = await arrangePlacedOrder({ userId: customer.id, lines: [{ productSlug: slug }] });
      await page.reload();
      await expect(page.getByText(/Used in 1 order, so it can't be deleted/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();

      // The database refuses a delete however it is asked.
      const admin = await signedInClient("e2e-admin@drincup.test");
      const { error } = await admin.rpc("admin_delete_product", { p_id: productId });
      expect(error?.code).toBe("DC030");

      await page.getByRole("button", { name: "Archive" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
      await expectToast(page, /Archived/);

      // Off the menu. (/menu streams behind a loading state, so a missing
      // product is the not-found page with a 200, not a 404 status.)
      await page.goto(`/menu/${slug}`);
      await expect(page.getByText("That item isn't on the menu")).toBeVisible();
      const row = must(await db().from("products").select("is_active, archived_at").eq("id", productId).single(), "product");
      expect(row.is_active).toBe(false);
      expect(row.archived_at).not.toBeNull();
      const line = must(await db().from("order_items").select("product_name, unit_price_cents, product_id").eq("order_id", orderId).single(), "line");
      expect(line).toEqual({ product_name: name, unit_price_cents: 275, product_id: productId });
    } finally {
      await retireProduct(slug);
    }
  });
});

test.describe("menu import", () => {
  const IMPORTED = ["ube-latte", "hojicha-latte", "lilikoi-hibiscus-cooler", "spam-musubi", "butter-mochi", "haupia-pie-slice"];

  test.afterEach(async () => {
    for (const slug of IMPORTED) await retireProduct(slug);
    await db().from("categories").delete().eq("slug", "bakery");
  });

  test("the example imports, re-importing changes nothing, and a bad file changes nothing", async ({ page }, testInfo) => {
    await signInAdmin(page, "/admin/menu/import");

    // The example, downloaded from the page.
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Filled-in example (Excel)" }).click();
    const examplePath = testInfo.outputPath("example.xlsx");
    await (await download).saveAs(examplePath);

    await page.getByLabel(/Spreadsheet/).setInputFiles(examplePath);
    await page.getByRole("button", { name: /Preview/ }).click();
    await expect(page.getByTestId("import-summary")).toContainText("6 rows: 6 new, 0 changed, 0 unchanged");
    await expect(page.getByTestId("import-summary")).toContainText("new categories: Bakery");
    // Previewing changed nothing.
    expect((await db().from("products").select("id").in("slug", IMPORTED)).data).toHaveLength(0);

    await page.getByRole("button", { name: "Apply import" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Apply import" }).click();
    await expectToast(page, "Imported: 6 new, 0 updated.");
    const created = must(await db().from("products").select("slug, is_active").in("slug", IMPORTED), "imported");
    expect(created).toHaveLength(6);
    const ube = must(
      await db().from("products").select("id, product_sizes(name, price_cents, is_default), product_modifier_groups(visible_when_option_id, modifier_groups(slug))").eq("slug", "ube-latte").single(),
      "ube",
    );
    expect(ube.product_sizes).toHaveLength(3);
    expect(ube.product_modifier_groups.find((l) => l.modifier_groups?.slug === "ice-level")?.visible_when_option_id).not.toBeNull();

    // Customers see it.
    expect((await page.request.get("/menu/ube-latte")).status()).toBe(200);

    // Again: nothing new.
    await page.getByLabel(/Spreadsheet/).setInputFiles(examplePath);
    await page.getByRole("button", { name: /Preview/ }).click();
    await expect(page.getByTestId("import-summary")).toContainText("6 rows: 0 new, 0 changed, 6 unchanged");
    await expect(page.getByRole("button", { name: "Nothing to change" })).toBeDisabled();
    expect(must(await db().from("products").select("id").in("slug", IMPORTED), "after re-import")).toHaveLength(6);

    // The audit log has the import as one entry.
    await page.goto("/admin/audit?table=products");
    await expect(page.getByTestId("audit-entry").filter({ hasText: "Menu import: 6 product(s) created" })).toHaveCount(1);

    // A bad file: row errors, nothing changes.
    const bad = [
      "Category,Product,Slug,Description,Price,Sizes,Modifier groups,Allergens,Dietary,Catering,Active",
      "Food & Snacks,E2E Bad Price,e2e-bad-price,,$5,,,,,,",
      "Food & Snacks,E2E Bad Group,e2e-bad-group,,5.50,,boba,,,,",
      "Food & Snacks,E2E Formula,e2e-formula,=HYPERLINK(\"http://x\"),5.50,,,,,,",
      "Food & Snacks,Spam Musubi,spam-musubi,Now pricier,9.99,,,,,,",
    ].join("\n");
    await page.goto("/admin/menu/import");
    await page.getByLabel(/Spreadsheet/).setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
    await page.getByRole("button", { name: /Preview/ }).click();
    const errors = page.getByTestId("import-errors");
    await expect(errors).toContainText("Row 2, Price: Write “$5” without the $ sign");
    await expect(errors).toContainText("Row 3, Modifier groups: Unknown modifier group “boba”");
    await expect(errors).toContainText("Row 4, Description: Cells can't start with “=”");
    await expect(page.getByRole("button", { name: "Apply import" })).toHaveCount(0);
    const musubi = must(await db().from("products").select("base_price_cents").eq("slug", "spam-musubi").single(), "musubi");
    expect(musubi.base_price_cents).toBe(375);
  });
});

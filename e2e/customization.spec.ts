/**
 * Customising and adding to the cart: live pricing, required choices,
 * sold-out and closed / paused states, and the cart count.
 */
import { expect, test } from "./support/test";

import { SEEDED } from "./support/db";
import { closeToday, markSoldOut, setPaused } from "./support/storefront";
import { addToCartButton, cartLink, openFromMenu } from "./support/ui";

test.describe("customisation", () => {
  test("customisation updates the price live", async ({ page }) => {
    await page.goto("/menu");
    const sheet = await openFromMenu(page, "Latte");
    const add = addToCartButton(sheet);

    await expect(add).toHaveText("Add to Cart · $5.75");

    await sheet.getByRole("radio", { name: /^Large/ }).check();
    await expect(add).toHaveText("Add to Cart · $6.50");

    await sheet.getByRole("radio", { name: /^Oat milk/ }).check();
    await expect(add).toHaveText("Add to Cart · $7.30");

    // Extra shots are charged per shot.
    await sheet.getByRole("button", { name: "Increase Extra espresso shot" }).click();
    await expect(add).toHaveText("Add to Cart · $8.30");
    await sheet.getByRole("button", { name: "Increase Extra espresso shot" }).click();
    await expect(add).toHaveText("Add to Cart · $9.30");
    await sheet.getByRole("button", { name: "Decrease Extra espresso shot" }).click();
    await expect(add).toHaveText("Add to Cart · $8.30");

    // A flavour is one price however many pumps.
    await sheet.getByRole("checkbox", { name: /^Vanilla/ }).check();
    await expect(add).toHaveText("Add to Cart · $9.05");
    await sheet.getByRole("button", { name: "Increase Vanilla" }).click();
    await expect(sheet.getByRole("group", { name: "Vanilla", exact: true }).locator("output")).toHaveText("2 pumps");
    await expect(add).toHaveText("Add to Cart · $9.05");

    await sheet.getByRole("button", { name: "Increase Quantity" }).click();
    await expect(add).toHaveText("Add to Cart · $18.10");

    // Screen readers hear the new price.
    await expect(sheet.locator("[aria-live=polite]").filter({ hasText: "Price now $18.10" })).toHaveCount(1);
  });

  test("Ice appears only once Iced is chosen", async ({ page }) => {
    await page.goto("/menu");
    const sheet = await openFromMenu(page, "Latte");

    await expect(sheet.getByRole("group", { name: /^Ice/ })).toHaveCount(0);
    await sheet.getByRole("radio", { name: /^Iced/ }).check();
    await expect(sheet.getByRole("group", { name: /^Ice\b/ })).toBeVisible();
    await expect(sheet.getByRole("radio", { name: /^Regular ice/ })).toBeChecked();
  });

  test("missing required selections block Add to Cart", async ({ page }) => {
    await page.goto("/menu");
    const sheet = await openFromMenu(page, "Classic Shave Ice");

    await addToCartButton(sheet).click();
    await expect(sheet.getByRole("alert")).toHaveText("Shave ice flavors: choose at least one.");
    await expect(sheet.getByRole("group", { name: /Shave ice flavors/ })).toHaveAttribute("aria-invalid", "true");
    // Still open: nothing was added.
    await expect(sheet).toBeVisible();

    await sheet.getByRole("checkbox", { name: /^Guava/ }).check();
    await expect(sheet.getByRole("alert")).toHaveCount(0);
    await addToCartButton(sheet).click();
    await expect(sheet).toBeHidden();
    // Exactly one: the blocked attempt added nothing.
    await expect(cartLink(page)).toHaveAccessibleName("Cart, 1 item");
  });

  test("the cart count updates after adding, and survives a reload", async ({ page }) => {
    await page.goto("/menu");
    await expect(cartLink(page)).toHaveAccessibleName("Cart, empty");

    let sheet = await openFromMenu(page, "Latte");
    await addToCartButton(sheet).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Added Latte to your cart")).toBeVisible();
    await expect(cartLink(page)).toHaveAccessibleName("Cart, 1 item");

    sheet = await openFromMenu(page, "Macadamia Nut Cookie");
    await sheet.getByRole("button", { name: "Increase Quantity" }).click();
    await addToCartButton(sheet).click();
    await expect(cartLink(page)).toHaveAccessibleName("Cart, 3 items");

    await page.reload();
    await expect(cartLink(page)).toHaveAccessibleName("Cart, 3 items");
  });

  test("a sold-out item or option can't be added", async ({ page }) => {
    const undo = await markSoldOut(SEEDED.cafeSlug, {
      productSlug: "banana-bread",
      option: { groupSlug: "milk", name: "Oat milk" },
    });
    try {
      await page.goto("/menu");

      const card = page.locator("article").filter({ has: page.getByRole("link", { name: "Banana Bread", exact: true }) });
      await expect(card.getByText("Sold out")).toBeVisible();

      let sheet = await openFromMenu(page, "Banana Bread");
      await expect(addToCartButton(sheet)).toHaveText("Sold out");
      await expect(addToCartButton(sheet)).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();

      sheet = await openFromMenu(page, "Latte");
      const oat = sheet.getByRole("radio", { name: /^Oat milk/ });
      await expect(oat).toBeDisabled();
      await expect(oat).toHaveAccessibleName(/Sold out/);
      // The drink itself can still be ordered with another milk.
      await expect(addToCartButton(sheet)).toBeEnabled();

      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(cartLink(page)).toHaveAccessibleName("Cart, empty");
    } finally {
      await undo();
    }
  });

  test("a paused location disables adding, with an explanation", async ({ page }) => {
    await setPaused(SEEDED.cafeSlug, true);
    try {
      await page.goto("/menu");
      await expect(page.getByRole("status").filter({ hasText: "Online ordering is paused" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Pickup location/ })).toContainText("Paused");

      const sheet = await openFromMenu(page, "Latte");
      await expect(addToCartButton(sheet)).toBeDisabled();
      await expect(sheet.getByText(/has paused online orders/)).toBeVisible();
      // Browsing still works.
      await sheet.getByRole("radio", { name: /^Large/ }).check();
      await expect(addToCartButton(sheet)).toHaveText("Add to Cart · $6.50");
    } finally {
      await setPaused(SEEDED.cafeSlug, false);
    }
  });

  test("a closed location disables adding, with an explanation", async ({ page }) => {
    const reopen = await closeToday(SEEDED.cafeSlug);
    try {
      await page.goto("/menu");
      await expect(page.getByRole("status").filter({ hasText: "We're closed right now" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Pickup location/ })).toContainText("Closed · Opens");

      // Browsing still works, on the shareable product page too.
      await page.goto("/menu/latte");
      await expect(page.getByRole("heading", { name: "Latte", level: 1 })).toBeVisible();
      await expect(addToCartButton(page)).toBeDisabled();
      await expect(page.getByText(/is closed right now\. Ordering opens/)).toBeVisible();
    } finally {
      await reopen();
    }
  });
});

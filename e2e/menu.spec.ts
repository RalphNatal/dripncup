/**
 * Browsing: the menu as a guest, search, the product sheet vs the shareable
 * full page, and pop-up menus.
 */
import { expect, test } from "./support/test";

import { SEEDED } from "./support/db";
import { eventMenuProductNames } from "./support/storefront";
import { addToCartButton, openFromMenu } from "./support/ui";

test.describe("menu", () => {
  test("a guest browses the menu and opens a product", async ({ page }) => {
    await page.goto("/menu");

    await expect(page.getByRole("heading", { name: "Menu", level: 1 })).toBeVisible();
    const locationButton = page.getByRole("button", { name: /Pickup location: Drincup Cafe — Kapiolani/ });
    await expect(locationButton).toBeVisible();
    await expect(locationButton).toContainText("Open");

    const chips = page.getByRole("navigation", { name: "Menu categories" });
    for (const category of ["Coffee & Espresso", "Tropical Refreshers", "Tea", "Shave Ice", "Food & Snacks"]) {
      await expect(chips.getByRole("link", { name: category, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Coffee & Espresso", level: 2 })).toBeVisible();

    const sheet = await openFromMenu(page, "Latte");
    await expect(page).toHaveURL(/\/menu\/latte$/);
    await expect(sheet.getByRole("group", { name: /Size/ })).toBeVisible();
    await expect(addToCartButton(sheet)).toHaveText("Add to Cart · $5.75");

    // Closing returns to the menu underneath.
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/menu$/);
    await expect(page.getByRole("heading", { name: "Menu", level: 1 })).toBeVisible();
  });

  test("a category chip jumps to its section", async ({ page }) => {
    await page.goto("/menu");
    const chip = page.getByRole("navigation", { name: "Menu categories" }).getByRole("link", { name: "Food & Snacks" });
    await chip.click();
    await expect(page.getByRole("heading", { name: "Food & Snacks", level: 2 })).toBeInViewport();
    await expect(chip).toHaveAttribute("aria-current", "true");
  });

  test("search matches names and descriptions, forgiving the ʻokina", async ({ page }) => {
    await page.goto("/menu");
    const search = page.getByLabel("Search the menu");
    // Product cards only; the seasonal banner links to some of the same items.
    const card = (name: string) => page.locator("article").getByRole("link", { name, exact: true });

    await search.fill("lilikoi");
    await expect(card("Lilikoʻi Lemonade")).toBeVisible();
    await expect(card("Latte")).toHaveCount(0);
    // The seasonal banner steps aside while searching.
    await expect(page.getByRole("heading", { name: "Summer Sunset" })).toHaveCount(0);

    await search.fill("chocolatey");
    await expect(card("Cold Brew")).toBeVisible();

    await search.fill("zzzz");
    await expect(page.getByText("No matches for “zzzz”")).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).last().click();
    await expect(card("Latte")).toBeVisible();
  });

  test("a direct product URL renders as a full page", async ({ page }) => {
    await page.goto("/menu/latte");

    await expect(page.getByRole("heading", { name: "Latte", level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Menu", exact: true }).first()).toBeVisible();
    await expect(addToCartButton(page)).toHaveText("Add to Cart · $5.75");
    await expect(page).toHaveTitle(/Latte/);
  });

  test("an unknown product URL shows a friendly not-found page", async ({ page }) => {
    await page.goto("/menu/not-a-real-drink");
    await expect(page.getByText("That item isn't on the menu")).toBeVisible();
    await expect(page.getByRole("link", { name: "See the menu" })).toBeVisible();
  });

  test("an event location shows only its menu subset", async ({ page }) => {
    const expected = await eventMenuProductNames(SEEDED.eventSlug);
    expect(expected.length).toBeGreaterThan(0);

    await page.goto("/menu");
    await page.getByRole("button", { name: /Pickup location/ }).click();
    const picker = page.getByRole("dialog", { name: "Pickup location" });
    await picker.getByRole("button", { name: /Pick up here at Kakaʻako/ }).click();
    await expect(picker).toBeHidden();
    await expect(page.getByRole("button", { name: /Pickup location: Kakaʻako/ })).toBeVisible();

    const menu = page.locator("#main");
    await expect(menu.getByText("Pickup at Kakaʻako Farmers Market Pop-Up")).toBeVisible();
    const shown = (await menu.locator("article h3 a").allTextContents()).sort();
    expect(shown).toEqual(expected);
    await expect(menu.getByRole("link", { name: "Latte", exact: true })).toHaveCount(0);

    // The seeded pop-up is two weeks out, so it cannot take orders yet.
    await expect(page.getByText("Pre-orders aren't open yet")).toBeVisible();
    const sheet = await openFromMenu(page, "Cold Brew");
    await expect(addToCartButton(sheet)).toBeDisabled();
    await expect(sheet.getByText(/Pre-orders for Kakaʻako Farmers Market Pop-Up open when the event starts/)).toBeVisible();
  });
});

test.describe("menu on desktop @desktop", () => {
  test("opens a product as a dialog, traps focus, and returns it on close", async ({ page }) => {
    await page.goto("/menu");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Menu" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    const card = page.getByRole("link", { name: "Latte", exact: true });
    await card.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Latte" });
    await expect(dialog).toBeVisible();

    // Tabbing never leaves the dialog.
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(card).toBeFocused();
  });
});

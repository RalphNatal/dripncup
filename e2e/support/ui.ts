import { expect, type Page } from "@playwright/test";

/** Opens a product from the menu page and returns its sheet / dialog. */
export async function openFromMenu(page: Page, productName: string) {
  await page.getByRole("link", { name: productName, exact: true }).click();
  const sheet = page.getByRole("dialog", { name: productName });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The header cart link; its accessible name carries the count. */
export function cartLink(page: Page) {
  return page.getByRole("link", { name: /^Cart,/ });
}

export function addToCartButton(scope: Page | ReturnType<Page["getByRole"]>) {
  return scope.getByRole("button", { name: /Add to Cart|Sold out/ });
}

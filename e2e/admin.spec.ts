/**
 * Phase 8: the admin shell. Admins only; the sections not built yet are
 * listed as "Coming soon", never as links; the home shows the three counts.
 */
import { expect, test } from "./support/test";

import { signIn } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, createCustomer } from "./support/db";
import { BARISTA } from "./support/orders";

test.describe("admin access", () => {
  test("guests are sent to sign in", async ({ page }) => {
    await page.goto("/admin/catering");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fcatering/);
  });

  test("a customer can't open /admin", async ({ page }) => {
    const user = await createCustomer("admin-denied");
    await signIn(page, user.email, user.password, "/account");
    for (const path of ["/admin", "/admin/catering", "/admin/events/new", "/admin/collections"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test("a barista can't open /admin", async ({ page }) => {
    await signIn(page, BARISTA, TEST_PASSWORD, "/staff");
    for (const path of ["/admin", "/admin/catering"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/$/);
    }
  });

  test("the admin sees the shell, the counts and Coming soon sections @desktop", async ({ page }) => {
    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/admin");
    const nav = page.getByRole("navigation", { name: "Admin" });
    for (const live of ["Home", "Catering", "Events", "Collections"]) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${live}`) })).toBeVisible();
    }
    for (const soon of ["Menu", "Locations", "Settings", "Promotions", "Rewards", "Users", "Reports"]) {
      await expect(nav.getByRole("link", { name: soon })).toHaveCount(0);
      await expect(nav.getByText(soon, { exact: true })).toBeVisible();
    }
    await expect(nav.getByText("Coming soon")).toHaveCount(7);
    for (const stat of ["admin-stat-catering", "admin-stat-events", "admin-stat-collections"]) {
      await expect(page.getByTestId(stat)).toBeVisible();
    }
    // The seeded collection is showing now.
    await expect(page.getByTestId("admin-stat-collections")).not.toContainText(/^\D*0\D*$/);
  });
});

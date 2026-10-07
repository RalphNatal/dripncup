/**
 * The admin dashboard's shell and its people-and-settings screens:
 * access (admins only, every page), the navigation, the attention queue,
 * settings with their audit trail, the setup checklist, and roles.
 */
import { expect, test } from "./support/test";

import { expectToast, setSettingValue, settingValue, signInAdmin } from "./support/admin";
import { addFromMenu, signIn, waitForCheckout } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, createCustomer, db, locationIdBySlug, must } from "./support/db";
import { BARISTA, arrangePlacedOrder, signedInClient } from "./support/orders";

/** Every admin page a guest, customer or barista must not open. */
const ADMIN_PAGES = [
  "/admin",
  "/admin/orders",
  "/admin/catering",
  "/admin/menu",
  "/admin/menu/categories",
  "/admin/menu/modifiers",
  "/admin/menu/products/new",
  "/admin/menu/sold-out",
  "/admin/menu/import",
  "/admin/locations",
  "/admin/events",
  "/admin/collections",
  "/admin/promos",
  "/admin/promos/new",
  "/admin/rewards",
  "/admin/rewards/members",
  "/admin/users",
  "/admin/reports",
  "/admin/settings",
  "/admin/setup",
  "/admin/content",
  "/admin/audit",
];

test.describe("admin access", () => {
  test("guests are sent to sign in", async ({ page }) => {
    await page.goto("/admin/catering");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fcatering/);
  });

  test("a customer can't open any admin page, or download admin files", async ({ page }) => {
    const user = await createCustomer("admin-denied");
    await signIn(page, user.email, user.password, "/account");
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/$/);
    }
    for (const path of ["/admin/reports/export?report=orders&from=2026-01-01&to=2026-12-31", "/admin/menu/import/template?file=example.csv"]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).not.toBe(200);
    }
  });

  test("a barista can't open any admin page", async ({ page }) => {
    await signIn(page, BARISTA, TEST_PASSWORD, "/staff");
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/$/);
    }
  });

  test("the admin sees every section in the navigation @desktop", async ({ page }) => {
    await signInAdmin(page);
    const nav = page.getByRole("navigation", { name: "Admin" });
    for (const label of ["Home", "Orders", "Catering", "Menu", "Locations", "Events", "Collections", "Promotions", "Rewards", "Users", "Reports", "Settings", "Setup checklist", "Pages & contact", "Audit log"]) {
      await expect(nav.getByRole("link", { name: new RegExp(`^${label}`) })).toBeVisible();
    }
    await expect(nav.getByText("Coming soon")).toHaveCount(0);
    for (const stat of ["admin-stat-catering", "admin-stat-events", "admin-stat-collections", "today-net-sales", "today-orders", "today-aov"]) {
      await expect(page.getByTestId(stat)).toBeVisible();
    }
  });
});

test.describe("needs attention", () => {
  test("a failed email can be retried from the queue, and then it's gone", async ({ page }) => {
    const user = await createCustomer("attention");
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, lines: [{ productSlug: "latte", sizeName: "Medium" }] });
    const email = must(
      await db()
        .from("email_outbox")
        .insert({ kind: "order_receipt", order_id: orderId, dedupe_key: `e2e-failed-${orderId}`, status: "failed", attempts: 6, last_error: "e2e: mailbox unavailable" })
        .select("id")
        .single(),
      "failed email",
    );

    await signInAdmin(page);
    const item = page.getByTestId("attention-item").filter({ hasText: orderNumber }).filter({ hasText: "Failed email" });
    await expect(item).toBeVisible();
    await expect(item).toContainText("e2e: mailbox unavailable");
    // The count: in the sidebar on a wide screen, on the menu button on a phone.
    await expect(page.getByTestId("admin-attention-badge").filter({ visible: true }).or(page.getByRole("button", { name: /needs? attention/ }))).toBeVisible();

    await item.getByTestId("attention-retry-email").click();
    await expectToast(page, "Sending it again now.");
    await expect(page.getByTestId("attention-item").filter({ hasText: orderNumber }).filter({ hasText: "Failed email" })).toHaveCount(0);
    await expect.poll(async () => (await db().from("email_outbox").select("status").eq("id", email.id).single()).data?.status, { timeout: 20_000 }).toBe("sent");
  });
});

test.describe("settings", () => {
  test("changing the tip choices shows at checkout and in the audit log", async ({ page, browser }) => {
    const original = await settingValue("tip.presets");
    try {
      await signInAdmin(page, "/admin/settings#tip.presets");
      const field = page.getByTestId("setting-tip.presets");
      await field.getByRole("textbox").fill("0, 15, 18, 25");
      await field.getByRole("button", { name: "Save" }).click();
      await expectToast(page, "Tip choices at checkout: No tip, 15%, 18%, 25%.");

      // A value the database would refuse is explained, not saved.
      await field.getByRole("textbox").fill("0, 15, 120");
      await field.getByRole("button", { name: "Save" }).click();
      await expect(field.getByRole("alert")).toHaveText("“120” isn't a whole percentage from 0 to 100.");
      expect(await settingValue("tip.presets")).toEqual([0, 15, 18, 25]);

      const customer = await createCustomer("tips");
      const context = await browser.newContext();
      const shopper = await context.newPage();
      await signIn(shopper, customer.email, customer.password);
      await addFromMenu(shopper, "Latte");
      await shopper.goto("/checkout");
      await waitForCheckout(shopper);
      await expect(shopper.getByText("25%", { exact: true })).toBeVisible();
      await expect(shopper.getByText("20%", { exact: true })).toHaveCount(0);
      await context.close();

      await page.goto("/admin/audit?table=settings");
      const entry = page.getByTestId("audit-entry").filter({ hasText: "tip.presets" }).first();
      await expect(entry).toContainText("Alika Admin");
      await expect(entry).toContainText("[0,15,18,25]");
    } finally {
      await setSettingValue("tip.presets", original);
    }
  });

  test("marking a setup item confirmed moves the progress on", async ({ page }) => {
    await db().from("setup_tasks").update({ confirmed_at: null, confirmed_by: null }).eq("key", "pos");
    await signInAdmin(page, "/admin/setup");
    const summary = page.getByTestId("setup-summary");
    const before = Number((await summary.innerText()).match(/(\d+) of (\d+) confirmed/)![1]);

    await page.getByTestId("confirm-pos").click();
    await expectToast(page, "Marked confirmed.");
    await expect(summary).toContainText(`${before + 1} of`);
    await page.goto("/admin");
    await expect(page.getByTestId("setup-progress")).toContainText(`${before + 1} of`);

    await page.goto("/admin/setup");
    await page.getByTestId("setup-item").filter({ hasText: "Point of sale" }).getByRole("button", { name: "Undo" }).click();
    await expect(summary).toContainText(`${before} of`);
  });
});

test.describe("users and roles", () => {
  test("make a customer staff at the cafe, then demote them", async ({ page, browser }) => {
    const person = await createCustomer("promote");
    await signInAdmin(page, `/admin/users/${person.id}`);

    // Role change needs the admin's own password.
    await page.getByRole("radio", { name: /^Staff/ }).check();
    await page.getByRole("button", { name: "Change role" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Enter your own password to confirm.");
    await dialog.getByLabel("Your password").fill("not-my-password");
    await dialog.getByRole("button", { name: "Change role" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("That password isn't right.");
    await dialog.getByLabel("Your password").fill(TEST_PASSWORD);
    await dialog.getByRole("button", { name: "Change role" }).click();
    await expectToast(page, "Now staff.");
    await expect(page.getByTestId("user-role")).toHaveText("staff");

    await page.getByRole("checkbox", { name: /Drincup Cafe/ }).check();
    await page.getByRole("button", { name: "Save locations" }).click();
    await expectToast(page, "Locations saved.");
    const cafeId = await locationIdBySlug(SEEDED.cafeSlug);
    expect((await db().from("staff_locations").select("location_id").eq("profile_id", person.id)).data).toEqual([{ location_id: cafeId }]);

    const context = await browser.newContext();
    const staffPage = await context.newPage();
    await signIn(staffPage, person.email, person.password, "/staff");
    await expect(staffPage).toHaveURL(/\/staff/);

    // Demote: the rosters go, and so does the counter screen.
    await page.getByRole("radio", { name: /^Customer/ }).check();
    await page.getByRole("button", { name: "Change role" }).click();
    await page.getByRole("dialog").getByLabel("Your password").fill(TEST_PASSWORD);
    await page.getByRole("dialog").getByRole("button", { name: "Change role" }).click();
    await expectToast(page, "Now a customer. Any staff locations were removed.");
    expect((await db().from("staff_locations").select("location_id").eq("profile_id", person.id)).data).toEqual([]);
    await staffPage.goto("/staff");
    await expect(staffPage).toHaveURL(/\/$/);
    await context.close();
  });

  test("the last admin can't be demoted, not even by themselves", async ({ page }) => {
    const admin = must(await db().from("profiles").select("id").eq("email", SEEDED.admin).single(), "admin");
    await signInAdmin(page, `/admin/users/${admin.id}`);
    await expect(page.getByText("You can't change your own role. Another admin can.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change role" })).toHaveCount(0);

    const client = await signedInClient(SEEDED.admin);
    const { error } = await client.rpc("admin_set_role", { p_user_id: admin.id, p_role: "customer" });
    expect(error?.code).toBe("DC050");
    expect(must(await db().from("profiles").select("role").eq("id", admin.id).single(), "role").role).toBe("admin");
  });
});

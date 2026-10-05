/**
 * "Delete my account", end to end: password re-entry, what happens to the
 * customer's history, and that the login is really gone.
 *
 * The database side (every table the deletion touches, the last-admin lock)
 * is covered in depth by supabase/tests/account_deletion.test.sql.
 */
import { expect, test, type Page } from "./support/test";

import { SEEDED, TEST_PASSWORD, createCustomer, db, locationIdBySlug, must } from "./support/db";

async function signIn(page: Page, email: string, password: string, next = "/account") {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("account deletion", () => {
  test("keeps history without personal data, and the login stops working", async ({ page }) => {
    const user = await createCustomer("delete");
    const cafeId = await locationIdBySlug(SEEDED.cafeSlug);
    const run = `${Date.now()}`;

    // One finished order, one still in the queue.
    const inserted = must(
      await db()
        .from("orders")
        .insert(
          [
            {
              user_id: user.id,
              location_id: cafeId,
              status: "picked_up",
              idempotency_key: `e2e-delete-past-${run}`,
              customer_first_name: "Kai",
              customer_email: user.email,
              customer_phone: "+18085550142",
              subtotal_cents: 575,
              taxable_base_cents: 575,
              tax_cents: 27,
              total_cents: 602,
            },
            {
              user_id: user.id,
              location_id: cafeId,
              status: "placed",
              idempotency_key: `e2e-delete-open-${run}`,
              customer_first_name: "Kai",
              customer_email: user.email,
              customer_phone: "+18085550142",
            },
          ],
          // Columns one row leaves out take their defaults, not NULL.
          { defaultToNull: false },
        )
        .select("id, idempotency_key"),
      "insert orders",
    );
    const pastOrder = inserted.find((o) => o.idempotency_key.includes("past"))!;
    const openOrder = inserted.find((o) => o.idempotency_key.includes("open"))!;

    const catering = must(
      await db()
        .from("catering_requests")
        .insert({
          user_id: user.id,
          contact_name: "Kai E2E",
          contact_email: user.email,
          contact_phone: "+18085550142",
          event_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
          headcount: 12,
        })
        .select("id")
        .single(),
      "insert catering request",
    );

    const orderIds = [pastOrder.id, openOrder.id];

    try {
      await signIn(page, user.email, user.password);
      await expect(page).toHaveURL(/\/account$/);

      await page.getByRole("link", { name: "Delete my account" }).click();
      await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();

      // Wrong password: refused, nothing deleted.
      await page.getByLabel("Your password", { exact: true }).fill("not-my-password");
      await page.getByLabel("Type DELETE to confirm").fill("DELETE");
      await page.getByRole("button", { name: "Delete my account" }).click();
      await expect(page.getByText("That password isn't right")).toBeVisible();

      const stillThere = await db().from("profiles").select("id, deleted_at").eq("id", user.id).single();
      expect(stillThere.data?.deleted_at).toBeNull();

      // Right password, but not typing DELETE: refused.
      await page.getByLabel("Your password", { exact: true }).fill(user.password);
      await page.getByLabel("Type DELETE to confirm").fill("delete");
      await page.getByRole("button", { name: "Delete my account" }).click();
      await expect(page.getByText("Type DELETE in capitals to confirm.")).toBeVisible();

      // Both right: deleted, signed out, sent home with a confirmation.
      await page.getByLabel("Your password", { exact: true }).fill(user.password);
      await page.getByLabel("Type DELETE to confirm").fill("DELETE");
      await page.getByRole("button", { name: "Delete my account" }).click();

      await expect(page).toHaveURL(/\/\?account=deleted$/);
      await expect(
        page.getByRole("status").filter({ hasText: "Your account has been deleted" }),
      ).toBeVisible();

      // Past orders still exist, with no personal data and no owner.
      const orders = must(
        await db()
          .from("orders")
          .select(
            "id, status, user_id, customer_first_name, customer_email, customer_phone, anonymized_at, total_cents",
          )
          .in("id", orderIds),
        "read orders back",
      );
      expect(orders).toHaveLength(2);
      for (const order of orders) {
        expect(order.user_id).toBeNull();
        expect(order.customer_first_name).toBeNull();
        expect(order.customer_email).toBeNull();
        expect(order.customer_phone).toBeNull();
        expect(order.anonymized_at).not.toBeNull();
      }
      expect(orders.find((o) => o.id === pastOrder.id)?.status).toBe("picked_up");
      expect(orders.find((o) => o.id === pastOrder.id)?.total_cents).toBe(602);
      expect(orders.find((o) => o.id === openOrder.id)?.status).toBe("cancelled");

      const cateringAfter = must(
        await db()
          .from("catering_requests")
          .select("status, user_id, contact_name, contact_email, contact_phone")
          .eq("id", catering.id)
          .single(),
        "read catering back",
      );
      expect(cateringAfter).toEqual({
        status: "cancelled",
        user_id: null,
        contact_name: null,
        contact_email: null,
        contact_phone: null,
      });

      // The profile and the login are gone.
      const profile = await db().from("profiles").select("id").eq("id", user.id).maybeSingle();
      expect(profile.data).toBeNull();
      const authUser = await db().auth.admin.getUserById(user.id);
      expect(authUser.data.user).toBeNull();

      // Signed out here, and cannot sign back in.
      await page.goto("/account");
      await expect(page).toHaveURL(/\/sign-in/);

      await signIn(page, user.email, user.password);
      await expect(page.getByText("That email and password don't match")).toBeVisible();
      await expect(page).toHaveURL(/\/sign-in/);
    } finally {
      // The anonymised rows are test data; do not leave them in the local DB.
      await db().from("orders").delete().in("id", orderIds);
      await db().from("catering_requests").delete().eq("id", catering.id);
      await db()
        .auth.admin.deleteUser(user.id)
        .catch(() => undefined);
    }
  });

  test("the only admin is asked to appoint another admin first", async ({ page }) => {
    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/account/delete");
    await expect(page).toHaveURL(/\/account\/delete$/);

    await expect(page.getByText("You're the only admin")).toBeVisible();
    await expect(page.getByLabel("Your password", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete my account" })).toHaveCount(0);
  });
});

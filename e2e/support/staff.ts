/**
 * The staff dashboard in the browser, for the Phase 6 suite.
 *
 *   openStaffQueue   sign in, open /staff and start the shift
 *   ticket / column  locators for one order's ticket and a queue column
 *   createStaff      a throwaway barista rostered at the given locations
 *   setStaffSetting  change a staff.* setting for the suite, with an undo
 */
import { expect, type Page } from "@playwright/test";

import { signIn } from "./checkout";
import { TEST_PASSWORD, db, locationIdBySlug, must } from "./db";

/**
 * Printing opens a dialog the test cannot dismiss; record what would have
 * printed instead (how many cup labels were on the page at that moment).
 */
export async function stubPrinting(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: { kind: string | null; labels: number }[] };
    w.__prints = [];
    window.print = () => {
      const view = document.querySelector("[data-testid=print-view]");
      w.__prints.push({
        kind: view?.getAttribute("data-kind") ?? null,
        labels: document.querySelectorAll("[data-testid=cup-label]").length,
      });
    };
  });
}

export async function prints(page: Page) {
  return page.evaluate(() => (window as unknown as { __prints: { kind: string | null; labels: number }[] }).__prints);
}

/** Signs in, opens the queue (optionally `?location=`) and taps Start shift. */
export async function openStaffQueue(page: Page, email: string, { location }: { location?: string } = {}) {
  await stubPrinting(page);
  const path = location ? `/staff?location=${location}` : "/staff";
  await signIn(page, email, TEST_PASSWORD, "/staff");
  if (location) await page.goto(path);
  await page.getByRole("button", { name: "Start shift" }).click();
  const dashboard = page.getByTestId("staff-dashboard");
  await expect(dashboard).toBeVisible();
  // Realtime joined (and the first refetch after it done) before the test acts.
  await expect(dashboard).toHaveAttribute("data-live", "true", { timeout: 20_000 });
  await page.waitForTimeout(500);
  return dashboard;
}

export function ticket(page: Page, orderNumber: string) {
  return page.locator(`[data-testid=ticket][data-order-number="${orderNumber}"]`).filter({ visible: true });
}

/** A queue column; on a tablet the four sit side by side. */
export function column(page: Page, id: "upcoming" | "new" | "in_progress" | "ready") {
  return page.getByTestId(`column-${id}`).filter({ visible: true });
}

export async function alertCount(page: Page): Promise<number> {
  return Number(await page.getByTestId("alert-state").getAttribute("data-alert-count"));
}

/** A barista rostered at exactly `locationSlugs`. */
export async function createStaff(label: string, locationSlugs: string[]) {
  const email = `e2e-staff-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@drincup.test`;
  const { data, error } = await db().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Ikaika Staff" },
  });
  if (error || !data.user) throw new Error(`create ${email}: ${error?.message ?? "no user"}`);
  must(
    await db().from("profiles").update({ role: "staff", first_name: "Ikaika" }).eq("id", data.user.id).select().single(),
    "make staff",
  );
  for (const slug of locationSlugs) {
    must(
      await db()
        .from("staff_locations")
        .insert({ profile_id: data.user.id, location_id: await locationIdBySlug(slug) })
        .select()
        .single(),
      `roster at ${slug}`,
    );
  }
  return { id: data.user.id, email };
}

export async function setStaffSetting(key: string, value: number) {
  const before = must(await db().from("settings").select("value").eq("key", key).single(), `read ${key}`);
  must(await db().from("settings").update({ value }).eq("key", key).select().single(), `set ${key}`);
  return async () => {
    await db().from("settings").update({ value: before.value }).eq("key", key);
  };
}

/** Moves the seeded pop-up's window to cover now; returns an undo. */
export async function makeEventLiveToday(slug: string) {
  const before = must(await db().from("locations").select("starts_at, ends_at").eq("slug", slug).single(), "event window");
  const starts = new Date(Date.now() - 60 * 60_000).toISOString();
  const ends = new Date(Date.now() + 4 * 60 * 60_000).toISOString();
  must(await db().from("locations").update({ starts_at: starts, ends_at: ends }).eq("slug", slug).select().single(), "event live");
  return async () => {
    await db().from("locations").update({ starts_at: before.starts_at, ends_at: before.ends_at }).eq("slug", slug);
  };
}

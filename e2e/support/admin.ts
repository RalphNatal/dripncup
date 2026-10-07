/**
 * Arranging and checking admin state for the Phase 9 suites. Service-role
 * writes here are test arrangement and clean-up only; what the tests check
 * goes through the admin screens.
 */
import { expect, type Page } from "@playwright/test";

import { signIn } from "./checkout";
import { SEEDED, TEST_PASSWORD, db, must } from "./db";

export async function signInAdmin(page: Page, next = "/admin") {
  await signIn(page, SEEDED.admin, TEST_PASSWORD, next.split("?")[0].split("#")[0]);
  if (next.includes("?") || next.includes("#")) await page.goto(next);
}

/** Toasts are announced in a live region; this waits for one by text. */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text }).first()).toBeVisible({ timeout: 15_000 });
}

/** Takes a product (and anything it made) off the menu for good, used or not. */
export async function retireProduct(slug: string) {
  const product = (await db().from("products").select("id").eq("slug", slug).maybeSingle()).data;
  if (!product) return;
  const used = (await db().from("order_items").select("id").eq("product_id", product.id).limit(1)).data?.length;
  if (used) await db().from("products").update({ is_active: false, archived_at: new Date().toISOString() }).eq("id", product.id);
  else await db().from("products").delete().eq("id", product.id);
}

export async function settingValue(key: string): Promise<unknown> {
  return must(await db().from("settings").select("value").eq("key", key).single(), `setting ${key}`).value;
}

export async function setSettingValue(key: string, value: unknown) {
  must(await db().from("settings").update({ value: value as never }).eq("key", key).select("key").single(), `set ${key}`);
}

/** The weekday name ("Monday") of the Honolulu date `daysAhead` from today. */
export function honoluluWeekday(daysAhead: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Honolulu", weekday: "long" }).format(new Date(Date.now() + daysAhead * 86_400_000));
}

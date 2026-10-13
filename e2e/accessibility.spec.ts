/**
 * Accessibility (WCAG 2.1 AA).
 *
 *   - axe-core on every main page and state, as each kind of visitor: a
 *     serious or critical violation fails the test. Stripe's card frames are
 *     Stripe's to answer for and are left out.
 *   - Reflow: no horizontal scrolling at 320 px wide (which is also what a
 *     1280 px screen at 400% zoom gives; 200% zoom is 640 px).
 *   - Touch targets: 44 px on the customer app, 56 px on the staff screen.
 *   - "Skip to content" first in the tab order everywhere.
 *   - prefers-reduced-motion stops animations.
 *   - The okina and kahako come from the brand fonts in every weight used.
 *   - Keyboard only: menu to a paid order, the staff queue, an admin form.
 */
import AxeBuilder from "@axe-core/playwright";

import { expect, test, type Locator, type Page } from "./support/test";

import { arrangeCateringRequest, arrangeQuote } from "./support/catering";
import { CARDS, addFromMenu, cardFrame, orderIdFromUrl, paymentIntentFromUrl, signIn, waitForCheckout } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, createCustomer, db, must } from "./support/db";
import { BARISTA, arrangePlacedOrder, forceStatus } from "./support/orders";
import { openStaffQueue, ticket } from "./support/staff";
import { relayRealEvent } from "./support/stripe";

const LATTE = { productSlug: "latte" };
const WCAG_21_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** A full load, then long enough for hydration and the first effects. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

/** Serious and critical WCAG 2.1 AA violations on the page as it is now. */
async function violations(page: Page, label: string): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_21_AA)
    // Stripe's card form and wallet buttons: Stripe's own frames.
    .exclude('iframe[src^="https://js.stripe.com"]')
    .analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${label}: [${v.impact}] ${v.id}: ${v.help}\n      ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join("\n      ")}`);
}

/** Visits each path and audits it; returns every problem found. */
async function auditPaths(page: Page, paths: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await settle(page);
    problems.push(...(await violations(page, path)));
  }
  return problems;
}

function expectNone(problems: string[]) {
  expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
}

test.describe.configure({ timeout: 180_000 });

test.describe("axe: no serious or critical WCAG 2.1 AA violations", () => {
  test("signed out", async ({ page }) => {
    const problems = await auditPaths(page, [
      "/",
      "/menu",
      "/menu/latte",
      "/rewards",
      "/cart",
      "/events",
      `/events/${SEEDED.eventSlug}`,
      "/collections/summer-sunset",
      "/catering",
      "/about",
      "/privacy",
      "/terms",
      "/accessibility",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/no-such-page",
      "/offline",
    ]);

    // The customization sheet over the menu, and a form showing its errors.
    await page.goto("/menu");
    await page.getByRole("link", { name: /^Latte/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settle(page);
    problems.push(...(await violations(page, "product sheet")));

    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in" }).click();
    await settle(page);
    problems.push(...(await violations(page, "sign-in with errors")));
    expectNone(problems);
  });

  test("a customer: cart, checkout, tracker, rewards, catering, account", async ({ page }) => {
    const user = await createCustomer("a11y-customer");
    const { orderId } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const ready = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await forceStatus(ready.orderId, ["accepted", "preparing", "ready"]);
    const request = await arrangeCateringRequest({ userId: user.id, email: user.email });
    await arrangeQuote(request.id);

    await signIn(page, user.email, user.password, "/menu");
    await addFromMenu(page, "Latte", 2);
    const problems = await auditPaths(page, [
      "/",
      "/menu",
      "/cart",
      "/checkout",
      `/orders/${orderId}`,
      `/orders/${ready.orderId}`,
      `/orders/${orderId}/confirmed`,
      "/orders",
      "/rewards",
      "/catering",
      "/events",
      "/account",
      "/account/favorites",
      "/account/password",
      "/account/catering",
      `/account/catering/${request.id}`,
      `/catering/${request.id}/pay`,
    ]);

    // Editing a cart line opens the product sheet again.
    await page.goto("/cart");
    await page.getByRole("button", { name: /^Edit/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settle(page);
    problems.push(...(await violations(page, "cart edit sheet")));
    expectNone(problems);
  });

  test("the staff dashboard @tablet", async ({ page }) => {
    const user = await createCustomer("a11y-staff");
    const placed = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const inProgress = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await forceStatus(inProgress.orderId, ["accepted"]);

    await signIn(page, BARISTA, TEST_PASSWORD, "/staff");
    await settle(page);
    const problems = await violations(page, "staff: start shift");

    await page.getByRole("button", { name: "Start shift" }).click();
    await expect(page.getByTestId("staff-dashboard")).toBeVisible();
    await expect(ticket(page, placed.orderNumber)).toBeVisible();
    await settle(page);
    problems.push(...(await violations(page, "staff: queue")));

    await ticket(page, placed.orderNumber).getByRole("button", { name: /details|open|view/i }).first().click().catch(() => ticket(page, placed.orderNumber).click());
    await settle(page);
    problems.push(...(await violations(page, "staff: ticket open")));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Pause online orders/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    problems.push(...(await violations(page, "staff: pause dialog")));
    await page.keyboard.press("Escape");
    expectNone(problems);
  });

  test("the staff dashboard in the dark counter theme, compact, with late tickets @tablet", async ({ page }) => {
    const user = await createCustomer("a11y-staff-dark");
    // One on time, one running behind (amber), one late (red), one being made late.
    const onTime = await arrangePlacedOrder({ userId: user.id, lines: [LATTE], notes: "Leave at the counter" });
    const behind = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const late = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const making = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    for (const [order, over] of [[behind, 6], [late, 14], [making, 20]] as const) {
      must(await db().from("orders").update({ estimated_ready_at: minutesAgo(over) }).eq("id", order.orderId).select("id").single(), "late");
    }
    await forceStatus(making.orderId, ["accepted", "preparing"]);
    await page.addInitScript(() => {
      localStorage.setItem("drincup:staff:theme", "dark");
      localStorage.setItem("drincup:staff:density", "compact");
    });

    await signIn(page, BARISTA, TEST_PASSWORD, "/staff");
    await settle(page);
    const problems = await violations(page, "staff dark: start shift");

    await page.getByRole("button", { name: "Start shift" }).click();
    await expect(page.getByTestId("staff-dashboard")).toHaveAttribute("data-theme", "dark");
    await expect(ticket(page, late.orderNumber)).toHaveAttribute("data-urgency", "late");
    await expect(ticket(page, behind.orderNumber)).toHaveAttribute("data-urgency", "warning");
    await expect(ticket(page, onTime.orderNumber)).toBeVisible();
    await settle(page);
    problems.push(...(await violations(page, "staff dark: queue")));

    await ticket(page, making.orderNumber).getByRole("button", { name: /^Open order/ }).click();
    await settle(page);
    problems.push(...(await violations(page, "staff dark: ticket open")));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Settings" }).click();
    await settle(page);
    problems.push(...(await violations(page, "staff dark: settings")));
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Pause online orders/ }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    problems.push(...(await violations(page, "staff dark: pause dialog")));
    await page.keyboard.press("Escape");
    expectNone(problems);
  });

  test("the admin @desktop", async ({ page }) => {
    const user = await createCustomer("a11y-admin");
    const { orderId } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const request = await arrangeCateringRequest({ userId: user.id, email: user.email });
    const pick = async (table: "products" | "modifier_groups" | "promos" | "rewards" | "collections", column: string, value: string) =>
      must(await db().from(table).select("id").eq(column, value).single(), `${table} ${value}`).id;
    const [latte, milk, promo, reward, collection] = await Promise.all([
      pick("products", "slug", "latte"),
      pick("modifier_groups", "slug", "milk"),
      pick("promos", "code", "MAHALO10"),
      pick("rewards", "name", "Free drink"),
      pick("collections", "slug", "summer-sunset"),
    ]);
    const event = must(await db().from("locations").select("id").eq("slug", SEEDED.eventSlug).single(), "event");

    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/admin");
    const problems = await auditPaths(page, [
      "/admin",
      "/admin/orders",
      `/admin/orders/${orderId}`,
      "/admin/catering",
      "/admin/catering?view=calendar",
      `/admin/catering/${request.id}`,
      "/admin/menu",
      "/admin/menu/categories",
      "/admin/menu/modifiers",
      `/admin/menu/modifiers/${milk}`,
      `/admin/menu/products/${latte}`,
      "/admin/menu/products/new",
      "/admin/menu/sold-out",
      "/admin/menu/import",
      "/admin/locations",
      "/admin/events",
      `/admin/events/${event.id}`,
      "/admin/collections",
      `/admin/collections/${collection}`,
      "/admin/promos",
      `/admin/promos/${promo}`,
      "/admin/rewards",
      `/admin/rewards/tiers/${reward}`,
      "/admin/users",
      `/admin/users/${user.id}`,
      "/admin/reports",
      "/admin/settings",
      "/admin/setup",
      "/admin/content",
      "/admin/audit",
    ]);
    expectNone(problems);
  });
});

test.describe("layout and targets", () => {
  test("no horizontal scrolling at 320 px (reflow, and 400% zoom)", async ({ page }) => {
    const user = await createCustomer("a11y-reflow");
    const { orderId } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await page.setViewportSize({ width: 320, height: 640 });
    await signIn(page, user.email, user.password, "/menu");
    await addFromMenu(page, "Latte");
    const wide: string[] = [];
    for (const path of ["/", "/menu", "/menu/latte", "/cart", "/checkout", `/orders/${orderId}`, "/orders", "/rewards", "/events", "/catering", "/account", "/about", "/accessibility"]) {
      await page.goto(path);
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) wide.push(`${path}: ${overflow}px too wide`);
    }
    expect(wide).toEqual([]);
  });

  /** Interactive elements smaller than `min` px, ignoring links inside a sentence. */
  async function smallTargets(page: Page, min: number, root = "body"): Promise<string[]> {
    return page.evaluate(
      ({ min, root }) => {
        const found: string[] = [];
        const container = document.querySelector(root) ?? document.body;
        for (const element of Array.from(container.querySelectorAll<HTMLElement>("a[href], button, select, input:not([type=hidden]), textarea, [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], summary"))) {
          const style = getComputedStyle(element);
          if (style.visibility === "hidden" || style.display === "none" || element.closest("[aria-hidden=true], [inert], .sr-only")) continue;
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          // A link in running text (WCAG's inline exception).
          if (element.tagName === "A" && style.display === "inline" && (element.parentElement?.textContent ?? "").trim().length > (element.textContent ?? "").trim().length + 2) continue;
          let target = box;
          // A stretched link (the card's ::after covers it): the card is the target.
          const after = getComputedStyle(element, "::after");
          if (after.content !== "none" && after.position === "absolute") {
            let host = element.parentElement;
            while (host && getComputedStyle(host).position === "static") host = host.parentElement;
            if (host) target = host.getBoundingClientRect();
          }
          // A checkbox, radio or switch: its label is part of the target.
          const label = element.closest("label") ?? (element.id ? document.querySelector(`label[for="${element.id}"]`) : null);
          if (label) {
            const area = label.getBoundingClientRect();
            if (area.height > target.height) target = area;
          }
          if (Math.round(target.height) < min || Math.round(target.width) < Math.min(min, 24)) {
            const name = (element.getAttribute("aria-label") ?? element.textContent ?? element.getAttribute("name") ?? element.tagName).trim().slice(0, 40);
            found.push(`${element.tagName.toLowerCase()} "${name}" ${Math.round(target.width)}x${Math.round(target.height)}`);
          }
        }
        return [...new Set(found)];
      },
      { min, root },
    );
  }

  test("touch targets are at least 44 px on the customer app", async ({ page }) => {
    const user = await createCustomer("a11y-targets");
    const { orderId } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await signIn(page, user.email, user.password, "/menu");
    await addFromMenu(page, "Latte");
    const small: string[] = [];
    for (const path of ["/", "/menu", "/menu/latte", "/cart", "/checkout", `/orders/${orderId}`, "/orders", "/rewards", "/events", "/catering", "/account"]) {
      await page.goto(path);
      await settle(page);
      for (const target of await smallTargets(page, 44)) small.push(`${path}: ${target}`);
    }
    expect(small).toEqual([]);
  });

  test("touch targets are at least 56 px on the staff screen @tablet", async ({ page }) => {
    const user = await createCustomer("a11y-staff-targets");
    const placed = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await openStaffQueue(page, BARISTA);
    await expect(ticket(page, placed.orderNumber)).toBeVisible();
    expect(await smallTargets(page, 56, "[data-testid=staff-dashboard]")).toEqual([]);
  });

  test("Skip to content comes first and moves focus to the page", async ({ page }) => {
    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/");
    for (const path of ["/", "/menu", "/sign-up", "/staff", "/admin"]) {
      if (path === "/sign-up") {
        await page.context().clearCookies();
      }
      await page.goto(path);
      await settle(page);
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip, path).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main").first(), path).toBeFocused();
      if (path === "/sign-up") await signIn(page, SEEDED.admin, TEST_PASSWORD, "/");
    }
  });

  test("prefers-reduced-motion stops animations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/menu");
    const durations = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "animate-spin";
      document.body.append(probe);
      const spin = getComputedStyle(probe).animationDuration;
      probe.className = "animate-pulse";
      const pulse = getComputedStyle(probe).animationDuration;
      probe.className = "transition-colors";
      const transition = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return { spin, pulse, transition };
    });
    for (const value of Object.values(durations)) expect(parseFloat(value)).toBeLessThan(0.001);
  });

  test("the okina and kahako come from the brand fonts in every weight", async ({ page }) => {
    await page.goto("/about");
    const missing = await page.evaluate(async () => {
      const heading = getComputedStyle(document.querySelector("h1")!).fontFamily;
      const body = getComputedStyle(document.body).fontFamily;
      const brand = (stack: string) => stack.split(",")[0].trim();
      const checks: Array<[string, number[]]> = [
        [brand(heading), [400, 500, 600, 700, 800]],
        [brand(body), [400, 500, 600, 700]],
      ];
      const canvas = document.createElement("canvas").getContext("2d")!;
      const problems: string[] = [];
      for (const [family, weights] of checks) {
        for (const weight of weights) {
          for (const glyph of ["ʻ", "ā", "ē", "ī", "ō", "ū", "Ā"]) {
            await document.fonts.load(`${weight} 32px ${family}`, glyph);
            // Drawn with the brand font in front of two different fallbacks: a
            // missing glyph comes out exactly as each fallback draws it (one
            // fallback alone can match a real glyph's width by chance).
            const width = (stack: string) => {
              canvas.font = `${weight} 32px ${stack}`;
              return canvas.measureText(glyph).width;
            };
            const fallsBack = ["monospace", "serif"].every((fallback) => Math.abs(width(`${family}, ${fallback}`) - width(fallback)) < 0.01);
            if (fallsBack) problems.push(`${family} ${weight} ${glyph}`);
          }
        }
      }
      return problems;
    });
    expect(missing).toEqual([]);
  });
});

/** Presses Tab until `target` has focus (at most `max` times): proves it is reachable by keyboard. */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Never reached ${target} with Tab`);
}

test.describe("keyboard only", () => {
  test.describe.configure({ timeout: 180_000 });

  test("from the menu to a paid order", async ({ page, request }) => {
    const since = Date.now();
    const user = await createCustomer("a11y-keys");
    await signIn(page, user.email, user.password, "/menu");

    // Open a product from the menu.
    const latte = page.getByRole("link", { name: /^Latte/ }).first();
    await tabTo(page, latte, 120);
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // Add it: focus is inside the sheet, and comes back out after.
    const add = sheet.getByRole("button", { name: /^Add to Cart/ });
    await tabTo(page, add);
    await page.keyboard.press("Enter");
    await expect(sheet).toBeHidden();

    const cart = page.getByRole("link", { name: /^Cart, 1 item/ }).first();
    await tabTo(page, cart, 120);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/cart$/);

    const checkout = page.getByRole("link", { name: /^Checkout/ });
    await tabTo(page, checkout, 120);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/checkout$/);
    await waitForCheckout(page);

    // Into Stripe's card form with Tab, typing as a keyboard user would.
    const frame = await cardFrame(page);
    /** Tabs until the card form's `name` field has focus, then types into it. */
    const typeInto = async (name: string, text: string, maxTabs = 120) => {
      for (let i = 0; i < maxTabs; i += 1) {
        if (await frame.evaluate((n) => (document.activeElement as HTMLInputElement | null)?.name === n, name).catch(() => false)) break;
        await page.keyboard.press("Tab");
      }
      expect(await frame.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).toBe(name);
      await page.keyboard.type(text, { delay: 20 });
    };
    await typeInto("number", CARDS.visa.replace(/\s/g, ""));
    await typeInto("expiry", "1234", 3);
    await typeInto("cvc", "123", 3);
    if (await frame.locator('input[name="postalCode"]').isVisible()) await typeInto("postalCode", "96814", 4);

    const pay = page.getByRole("button", { name: /^Pay \$/ });
    await tabTo(page, pay);
    await page.keyboard.press("Enter");

    const intent = await paymentIntentFromUrl(page);
    const orderId = orderIdFromUrl(page);
    await relayRealEvent(request, "payment_intent.succeeded", intent, { since });
    await expect(page.getByRole("heading", { name: "Mahalo!" })).toBeVisible({ timeout: 30_000 });
    expect(must(await db().from("orders").select("status").eq("id", orderId).single(), "order").status).toBe("placed");
  });

  test("the staff queue: accept and start an order @tablet", async ({ page }) => {
    const user = await createCustomer("a11y-keys-staff");
    const placed = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await signIn(page, BARISTA, TEST_PASSWORD, "/staff");
    const start = page.getByRole("button", { name: "Start shift" });
    await tabTo(page, start);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("staff-dashboard")).toHaveAttribute("data-live", "true", { timeout: 20_000 });

    const accept = ticket(page, placed.orderNumber).getByRole("button", { name: /^Accept/ });
    await tabTo(page, accept, 120);
    await page.keyboard.press("Enter");
    await expect.poll(async () => must(await db().from("orders").select("status").eq("id", placed.orderId).single(), "order").status).toBe("accepted");
  });

  test("an admin form: edit and save site content @desktop", async ({ page }) => {
    await signIn(page, SEEDED.admin, TEST_PASSWORD, "/admin/content");
    const field = page.getByRole("textbox", { name: "Accessibility statement" });
    await tabTo(page, field, 200);
    const before = await field.inputValue();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" (keyboard check)");
    await tabTo(page, page.getByRole("button", { name: "Save accessibility statement" }), 5);
    await page.keyboard.press("Enter");
    await expect.poll(async () => must(await db().from("site_content").select("value").eq("key", "accessibility").single(), "content").value).toBe(
      `${before} (keyboard check)`,
    );
    must(await db().from("site_content").update({ value: before }).eq("key", "accessibility").select("key").single(), "restore");
  });
});

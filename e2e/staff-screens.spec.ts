/**
 * Screenshots of the staff dashboard for design review, not a test of
 * behaviour: `npm run test:e2e -- --project=screens`.
 *
 * Three queues are arranged on the e2e stack (never the dev database): empty,
 * a quiet three orders, and a rush of 25 with a mix of on-time, running-behind
 * and late tickets, scheduled orders, notes, special instructions and
 * allergens. Each is shot at every size the dashboard is designed for, in the
 * light and dark counter themes, into docs/screenshots/staff/<set>/ where
 * <set> is STAFF_SHOTS (default "after"; "before" was taken from the Phase 10
 * screen). Shots are of the viewport, as a counter screen shows it. The
 * "after" set adds extras on the rush queue: compact tickets, the detail view
 * as a panel, a sheet and full screen, the settings popover and the phone menu.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "./support/test";

import { SEEDED, createCustomer, db, locationIdBySlug, must } from "./support/db";
import { BARISTA, arrangePlacedOrder, forceStatus, type ArrangedLine } from "./support/orders";
import { openStaffQueue } from "./support/staff";

const SET = process.env.STAFF_SHOTS ?? "after";
const OUT = join("docs", "screenshots", "staff", SET);
const THEMES = (process.env.STAFF_SHOT_THEMES ?? (SET === "before" ? "light" : "light,dark")).split(",");
/** Optional filters while iterating: STAFF_SHOT_SIZES=1180,390 STAFF_SHOT_SCENARIOS=25-orders */
const ONLY_SIZES = process.env.STAFF_SHOT_SIZES?.split(",");
const ONLY_SCENARIOS = process.env.STAFF_SHOT_SCENARIOS?.split(",");

const SIZES = [
  { name: "phone-390x844", width: 390, height: 844, mobile: true },
  { name: "tablet-portrait-768x1024", width: 768, height: 1024, mobile: true },
  { name: "tablet-landscape-1024x768", width: 1024, height: 768, mobile: true },
  { name: "tablet-landscape-1180x820", width: 1180, height: 820, mobile: true },
  { name: "laptop-1366x1024", width: 1366, height: 1024, mobile: false },
  { name: "laptop-1440x900", width: 1440, height: 900, mobile: false },
  { name: "display-1920x1080", width: 1920, height: 1080, mobile: false },
] as const;

const MINUTE = 60_000;

const NAMES = [
  "Leilani", "Kekoa", "Malia", "Noa", "Iolani", "Pua", "Kalani", "Keoni", "Mahina", "Kai",
  "Ikaika", "Nalu", "Makana", "Lokelani", "Kawika", "Anela", "Koa", "Hōkū", "Maile", "Kainoa",
  "Alana", "Ikaika M.", "Kaleo", "Nani", "Palani",
];

const DRINKS: ArrangedLine[] = [
  {
    productSlug: "latte",
    sizeName: "Medium",
    options: [
      { groupSlug: "temperature", name: "Iced" },
      { groupSlug: "milk", name: "Oat milk" },
      { groupSlug: "syrups", name: "Vanilla", quantity: 2 },
    ],
  },
  { productSlug: "cold-brew", sizeName: "Large", options: [{ groupSlug: "add-milk", name: "Macadamia milk" }] },
  {
    productSlug: "pog-refresher",
    sizeName: "Large",
    options: [
      { groupSlug: "sweetness", name: "50%" },
      { groupSlug: "ice-level", name: "Light ice" },
      { groupSlug: "toppings", name: "Li hing powder" },
    ],
  },
  { productSlug: "matcha-latte", sizeName: "Small", options: [{ groupSlug: "milk", name: "Almond milk" }] },
  {
    productSlug: "mocha",
    sizeName: "Large",
    options: [
      { groupSlug: "espresso-shots", name: "Extra espresso shot", quantity: 2 },
      { groupSlug: "toppings", name: "Whipped cream" },
    ],
  },
  { productSlug: "rainbow-shave-ice", sizeName: "Regular", options: [{ groupSlug: "shave-ice-addons", name: "Mochi bites" }] },
  { productSlug: "malasada" },
  { productSlug: "americano", sizeName: "Medium" },
];

/** Puts every live order at the cafe out of the way, so a scenario starts from an empty queue. */
async function clearQueue() {
  const cafeId = await locationIdBySlug(SEEDED.cafeSlug);
  const live = must(
    await db().from("orders").select("id, status").eq("location_id", cafeId).in("status", ["placed", "accepted", "preparing", "ready"]),
    "live orders",
  );
  const path = ["placed", "accepted", "preparing", "ready", "picked_up"] as const;
  for (const order of live) {
    await forceStatus(order.id, path.slice(path.indexOf(order.status as (typeof path)[number]) + 1) as never);
  }
}

interface Arrangement {
  status: "placed" | "accepted" | "preparing" | "ready";
  /** Minutes ago it was placed. */
  placedAgo: number;
  /** Minutes from now the customer was told it would be ready (negative = already past). */
  readyIn: number;
  scheduledIn?: number;
  lines: ArrangedLine[];
  notes?: string;
}

async function arrange(userId: string, orders: Arrangement[]) {
  for (const [index, spec] of orders.entries()) {
    const { orderId } = await arrangePlacedOrder({
      userId,
      cupName: NAMES[index % NAMES.length],
      notes: spec.notes,
      lines: spec.lines,
      scheduledFor: spec.scheduledIn ? new Date(Date.now() + spec.scheduledIn * MINUTE) : undefined,
    });
    must(
      await db()
        .from("orders")
        .update({
          placed_at: new Date(Date.now() - spec.placedAgo * MINUTE).toISOString(),
          estimated_ready_at: spec.scheduledIn
            ? new Date(Date.now() + spec.scheduledIn * MINUTE).toISOString()
            : new Date(Date.now() + spec.readyIn * MINUTE).toISOString(),
        })
        .eq("id", orderId)
        .select("id")
        .single(),
      "times",
    );
    const path = (["accepted", "preparing", "ready"] as const).slice(0, ["placed", "accepted", "preparing", "ready"].indexOf(spec.status));
    if (path.length) await forceStatus(orderId, [...path]);
  }
}

const line = (i: number, extra: Partial<ArrangedLine> = {}): ArrangedLine => ({ ...DRINKS[i % DRINKS.length], ...extra });

const QUIET: Arrangement[] = [
  { status: "placed", placedAgo: 1, readyIn: 7, lines: [line(0, { specialInstructions: "Extra hot please" })] },
  { status: "preparing", placedAgo: 6, readyIn: 2, lines: [line(2), line(6)] },
  { status: "ready", placedAgo: 11, readyIn: -2, lines: [line(1)] },
];

/** A rush: 2 upcoming, 6 new, 10 in progress, 7 ready, with late and running-behind tickets. */
const RUSH: Arrangement[] = [
  { status: "placed", placedAgo: 3, readyIn: 0, scheduledIn: 55, lines: [line(3), line(6)] },
  { status: "placed", placedAgo: 9, readyIn: 0, scheduledIn: 85, lines: [line(4, { quantity: 3 })] },
  { status: "placed", placedAgo: 24, readyIn: -14, lines: [line(0), line(2)], notes: "Running 5 minutes late" },
  { status: "placed", placedAgo: 19, readyIn: -11, lines: [line(5)] },
  { status: "placed", placedAgo: 14, readyIn: -6, lines: [line(1, { specialInstructions: "Half the ice please" })] },
  { status: "placed", placedAgo: 3, readyIn: 6, lines: [line(7)] },
  { status: "placed", placedAgo: 2, readyIn: 7, lines: [line(4), line(0)] },
  { status: "placed", placedAgo: 0, readyIn: 9, lines: [line(3)] },
  { status: "preparing", placedAgo: 140, readyIn: -128, lines: [line(2, { quantity: 2 })], notes: "Birthday — write Hau'oli on the cup" },
  { status: "preparing", placedAgo: 23, readyIn: -12, lines: [line(0)] },
  { status: "preparing", placedAgo: 16, readyIn: -7, lines: [line(1), line(6)] },
  { status: "preparing", placedAgo: 13, readyIn: -5, lines: [line(5)] },
  { status: "preparing", placedAgo: 8, readyIn: 1, lines: [line(3, { specialInstructions: "No whip, light ice" })] },
  { status: "preparing", placedAgo: 6, readyIn: 3, lines: [line(4)] },
  { status: "accepted", placedAgo: 15, readyIn: -6, lines: [line(2), line(7)] },
  { status: "accepted", placedAgo: 5, readyIn: 4, lines: [line(0, { quantity: 2 })] },
  { status: "accepted", placedAgo: 4, readyIn: 5, lines: [line(1)] },
  { status: "accepted", placedAgo: 3, readyIn: 6, lines: [line(6)] },
  { status: "ready", placedAgo: 18, readyIn: -8, lines: [line(0)] },
  { status: "ready", placedAgo: 15, readyIn: -6, lines: [line(2)] },
  { status: "ready", placedAgo: 14, readyIn: -4, lines: [line(3), line(6)] },
  { status: "ready", placedAgo: 12, readyIn: -3, lines: [line(4)] },
  { status: "ready", placedAgo: 11, readyIn: -2, lines: [line(5)] },
  { status: "ready", placedAgo: 9, readyIn: 0, lines: [line(7)] },
  { status: "ready", placedAgo: 8, readyIn: 1, lines: [line(1)] },
];

type Size = (typeof SIZES)[number];

/** Opens the queue at one size with this device's display settings, runs `then`, and saves the shot. */
async function shot(
  browser: Browser,
  size: Size,
  file: string,
  settings: { theme: string; density?: string },
  then?: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    hasTouch: size.mobile,
    isMobile: size.width < 800,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(({ theme, density }) => {
    try {
      localStorage.setItem("drincup:staff:theme", theme);
      if (density) localStorage.setItem("drincup:staff:density", density);
    } catch {
      // Ignore.
    }
  }, settings);
  const page = await context.newPage();
  try {
    await openStaffQueue(page, BARISTA);
    await page.waitForTimeout(1500);
    if (then) await then(page);
    await page.screenshot({ path: join(OUT, file) });
  } finally {
    await context.close();
  }
}

async function shoot(browser: Browser, scenario: string) {
  if (ONLY_SCENARIOS && !ONLY_SCENARIOS.includes(scenario)) return;
  mkdirSync(OUT, { recursive: true });
  for (const size of SIZES) {
    if (ONLY_SIZES && !ONLY_SIZES.some((width) => size.name.includes(`${width}x`))) continue;
    for (const theme of THEMES) await shot(browser, size, `${size.name}-${scenario}-${theme}.png`, { theme });
  }
}

const size = (width: number) => SIZES.find((s) => s.width === width)!;

/** The redesign's other states, on the rush queue: compact tickets, the detail view at each size, settings. */
async function extras(browser: Browser) {
  if (SET === "before" || (ONLY_SCENARIOS && !ONLY_SCENARIOS.includes("extras"))) return;
  const openFirst = async (page: Page) => {
    await page.locator("[data-testid=ticket]").filter({ visible: true }).nth(1).getByRole("button", { name: /^Open order/ }).click();
    await page.waitForTimeout(800);
  };
  for (const theme of ["light", "dark"]) {
    await shot(browser, size(1180), `extra-compact-1180x820-25-orders-${theme}.png`, { theme, density: "compact" });
    await shot(browser, size(1920), `extra-compact-1920x1080-25-orders-${theme}.png`, { theme, density: "compact" });
    await shot(browser, size(1440), `extra-detail-panel-1440x900-${theme}.png`, { theme }, openFirst);
  }
  await shot(browser, size(390), "extra-compact-390x844-25-orders-light.png", { theme: "light", density: "compact" });
  await shot(browser, size(1366), "extra-detail-panel-1366x1024-light.png", { theme: "light" }, openFirst);
  await shot(browser, size(1024), "extra-detail-sheet-1024x768-light.png", { theme: "light" }, openFirst);
  await shot(browser, size(390), "extra-detail-fullscreen-390x844-light.png", { theme: "light" }, openFirst);
  await shot(browser, size(1180), "extra-settings-1180x820-light.png", { theme: "light" }, async (page) => {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForTimeout(500);
  });
  await shot(browser, size(390), "extra-menu-390x844-dark.png", { theme: "dark" }, async (page) => {
    await page.getByRole("button", { name: "Menu" }).click();
    await page.waitForTimeout(600);
  });
}

test.describe.configure({ timeout: 25 * 60_000 });

test("staff dashboard screenshots @screens", async ({ browser }) => {
  const user = await createCustomer("staff-shots");

  await clearQueue();
  await shoot(browser, "0-orders");

  await arrange(user.id, QUIET);
  await shoot(browser, "3-orders");

  await clearQueue();
  await arrange(user.id, RUSH);
  await shoot(browser, "25-orders");
  await extras(browser);

  await clearQueue();
  expect(true).toBe(true);
});

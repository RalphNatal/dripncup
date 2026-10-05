/**
 * Phase 6: the staff dashboard.
 *
 * Most tests run on the "tablet" project (a 1280×800 landscape counter
 * tablet, tagged @tablet), where the four queue columns sit side by side;
 * the phone layout and the access checks run on the default phone project.
 *
 * Orders are placed with the same SQL functions checkout and the payment
 * webhook use (arrangePlacedOrder), or, where a real refund is needed, paid
 * in the Stripe sandbox (arrangePendingOrder + a delivered webhook). Neither
 * page is ever reloaded while it waits: a marker on `window` proves it.
 */
import { expect, test, type Browser, type Page } from "./support/test";

import { addFromMenu, signIn } from "./support/checkout";
import { SEEDED, TEST_PASSWORD, createCustomer, db, locationIdBySlug, must } from "./support/db";
import { BARISTA, arrangePlacedOrder, closeClients, forceStatus, signedInClient } from "./support/orders";
import {
  alertCount,
  column,
  createStaff,
  makeEventLiveToday,
  openStaffQueue,
  prints,
  setStaffSetting,
  ticket,
} from "./support/staff";
import { arrangePendingOrder, deliver, fixtureEvent } from "./support/stripe";

const LATTE = {
  productSlug: "latte",
  sizeName: "Medium",
  options: [
    { groupSlug: "temperature", name: "Iced" },
    { groupSlug: "milk", name: "Oat milk" },
    { groupSlug: "syrups", name: "Vanilla", quantity: 2 },
  ],
};

async function markPage(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __noReload?: boolean }).__noReload = true;
  });
}

async function expectNotReloaded(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true);
}

/** A customer watching their own order's tracker, in a separate browser context. */
async function openTracker(browser: Browser, user: { email: string; password: string }, orderId: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, user.email, user.password, `/orders/${orderId}`);
  await expect(page.getByText("Live updates on")).toBeVisible({ timeout: 15_000 });
  await markPage(page);
  return { page, close: () => context.close() };
}

async function historyActors(orderId: string) {
  return must(
    await db().from("order_status_history").select("to_status, changed_by").eq("order_id", orderId).order("created_at"),
    "history",
  );
}

// Several tests wait on real timers (the undo window, the chime, the pause check).
test.describe.configure({ timeout: 120_000 });

let restoreRepeat: () => Promise<void>;

test.beforeAll(async () => {
  // The chime repeats every 15 s in production; 5 s keeps the suite quick
  // without changing the logic under test.
  restoreRepeat = await setStaffSetting("staff.new_order_repeat_seconds", 5);
});

test.afterAll(async () => {
  await restoreRepeat?.();
  await closeClients();
});

test.describe("the live queue @tablet", () => {
  test("a new order appears in New without a reload, and the alert repeats until acknowledged", async ({ page }) => {
    const user = await createCustomer("staff-new");
    await openStaffQueue(page, BARISTA);
    await markPage(page);
    const before = await alertCount(page);

    const { orderNumber } = await arrangePlacedOrder({
      userId: user.id,
      cupName: "Leilani",
      notes: "Running 5 minutes late",
      lines: [{ ...LATTE, specialInstructions: "Extra hot please" }],
    });

    const card = column(page, "new").locator(`[data-order-number="${orderNumber}"]`);
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveAttribute("data-unacknowledged", "true");
    await expect(card.getByTestId("cup-name")).toHaveText("Leilani");
    await expect(card.getByTestId("pickup")).toHaveText("ASAP");
    // Selections in build order, each on its own line; notes and instructions boxed; allergens flagged.
    await expect(card.getByTestId("ticket-selection")).toHaveText(["Iced", "Oat milk", "Vanilla (2 pumps)"]);
    await expect(card.getByTestId("order-notes")).toContainText("Running 5 minutes late");
    await expect(card.getByTestId("special-instructions")).toHaveText("Extra hot please");
    await expect(card.getByTestId("allergens")).toContainText("Gluten");
    await expect(page.getByTestId("new-order-alert")).toBeVisible();
    await expect(page).toHaveTitle(/^\(\d+\) New order/);

    // It rang on arrival and keeps ringing.
    await expect.poll(() => alertCount(page), { timeout: 5_000 }).toBeGreaterThan(before);
    const first = await alertCount(page);
    await expect.poll(() => alertCount(page), { timeout: 12_000 }).toBeGreaterThanOrEqual(first + 1);

    await page.getByTestId("new-order-alert").getByRole("button", { name: "Acknowledge" }).click();
    await expect(page.getByTestId("new-order-alert")).toBeHidden();
    await expect(card).not.toHaveAttribute("data-unacknowledged", "true");
    const settled = await alertCount(page);
    await page.waitForTimeout(7_000);
    expect(await alertCount(page)).toBe(settled);
    // Still in New (acknowledging is not accepting).
    await expect(card).toBeVisible();
    await expectNotReloaded(page);
  });

  test("Accept → Start → Ready (with undo) → Picked up, and the customer's tracker follows each step", async ({ page, browser }) => {
    const user = await createCustomer("staff-flow");
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, cupName: "Kekoa", lines: [LATTE] });
    const tracker = await openTracker(browser, user, orderId);
    const status = tracker.page.getByTestId("order-status").first();

    try {
      await openStaffQueue(page, BARISTA);
      await markPage(page);
      const card = ticket(page, orderNumber);

      await card.getByRole("button", { name: "Accept", exact: true }).click();
      await expect(column(page, "in_progress").locator(`[data-order-number="${orderNumber}"]`)).toBeVisible();
      await expect(card.getByTestId("progress-badge")).toHaveText("Accepted");
      await expect(status).toHaveText("Accepted");

      await card.getByRole("button", { name: "Start", exact: true }).click();
      await expect(card.getByTestId("progress-badge")).toHaveText("Preparing");
      await expect(status).toHaveText("Preparing");

      // Ready waits five seconds, with Undo, before anything is sent.
      await card.getByRole("button", { name: "Ready", exact: true }).click();
      await expect(page.getByTestId("undo-toasts")).toContainText("Marking ready…");
      await expect(card.getByRole("button", { name: "Undo" })).toBeVisible();
      expect(must(await db().from("orders").select("status").eq("id", orderId).single(), "status").status).toBe("preparing");
      await expect(column(page, "ready").locator(`[data-order-number="${orderNumber}"]`)).toBeVisible({ timeout: 10_000 });
      await expect(tracker.page.getByTestId("ready-banner")).toBeVisible();
      await expect(status).toHaveText("Ready");

      await card.getByRole("button", { name: "Picked up", exact: true }).click();
      await expect(page.getByTestId("undo-toasts")).toContainText("Marking picked up…");
      await expect(card).toBeHidden({ timeout: 10_000 });
      await expect(status).toHaveText("Picked up");

      // It is in today's completed list.
      await page.getByRole("button", { name: "Completed" }).click();
      await page.getByPlaceholder("Order number or cup name").fill("Kekoa");
      await expect(page.getByTestId("completed-order").filter({ hasText: orderNumber })).toContainText("Picked up");

      const baristaId = (await (await signedInClient(BARISTA)).auth.getUser()).data.user!.id;
      expect((await historyActors(orderId)).filter((h) => h.changed_by === baristaId).map((h) => h.to_status)).toEqual([
        "accepted",
        "preparing",
        "ready",
        "picked_up",
      ]);
      await expectNotReloaded(page);
      await expectNotReloaded(tracker.page);
    } finally {
      await tracker.close();
    }
  });

  test("Undo during the Ready countdown keeps the order Preparing, and the customer is not alerted", async ({ page, browser }) => {
    const user = await createCustomer("staff-undo");
    // The customer would get a "ready" email if anything were sent.
    must(
      await db().from("profiles").update({ notification_prefs: { order_ready_push: true, order_ready_email: true } }).eq("id", user.id).select().single(),
      "opt in to ready emails",
    );
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, cupName: "Malia", lines: [LATTE] });
    await forceStatus(orderId, ["accepted", "preparing"]);
    const tracker = await openTracker(browser, user, orderId);

    try {
      await openStaffQueue(page, BARISTA);
      const card = ticket(page, orderNumber);
      await card.getByRole("button", { name: "Ready", exact: true }).click();
      await page.getByTestId("undo-toasts").getByRole("button", { name: "Undo" }).click();
      await expect(page.getByTestId("undo-toasts")).toBeHidden();

      await page.waitForTimeout(7_000);
      expect(must(await db().from("orders").select("status").eq("id", orderId).single(), "status").status).toBe("preparing");
      await expect(card.getByTestId("progress-badge")).toHaveText("Preparing");
      await expect(card.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
      await expect(tracker.page.getByTestId("order-status").first()).toHaveText("Preparing");
      await expect(tracker.page.getByTestId("ready-banner")).toBeHidden();
      const owed = must(await db().from("email_outbox").select("kind").eq("order_id", orderId), "outbox");
      expect(owed.map((e) => e.kind)).not.toContain("order_ready");
    } finally {
      await tracker.close();
    }
  });

  test("two staff sessions act on the same order: no error, and both screens end up correct", async ({ page, browser }) => {
    const user = await createCustomer("staff-two");
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, cupName: "Noa", lines: [LATTE] });

    // A second counter device whose Realtime connection never comes up, so
    // its screen is still showing the order as New when it taps.
    const otherContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const other = await otherContext.newPage();
    try {
      await other.routeWebSocket(/\/realtime\//, () => {
        // Swallow the socket: never connect to the server.
      });
      await signIn(other, BARISTA, TEST_PASSWORD, "/staff");
      await other.getByRole("button", { name: "Start shift" }).click();
      await expect(ticket(other, orderNumber).getByRole("button", { name: "Accept", exact: true })).toBeVisible();

      await openStaffQueue(page, SEEDED.admin);
      await ticket(page, orderNumber).getByRole("button", { name: "Accept", exact: true }).click();
      await expect(ticket(page, orderNumber).getByTestId("progress-badge")).toHaveText("Accepted");

      // The stale screen taps Accept too: told gently, and refreshed.
      await ticket(other, orderNumber).getByRole("button", { name: "Accept", exact: true }).click();
      await expect(other.getByText("Already updated")).toBeVisible();
      await expect(ticket(other, orderNumber).getByTestId("progress-badge")).toHaveText("Accepted");

      // Both tap Start at the same moment.
      await Promise.all([
        ticket(page, orderNumber).getByRole("button", { name: "Start", exact: true }).click(),
        ticket(other, orderNumber).getByRole("button", { name: "Start", exact: true }).click(),
      ]);
      await expect(ticket(page, orderNumber).getByTestId("progress-badge")).toHaveText("Preparing");
      await expect(ticket(other, orderNumber).getByTestId("progress-badge")).toHaveText("Preparing");
      for (const screen of [page, other]) {
        await expect(screen.getByText(/Couldn't|not rostered/)).toHaveCount(0);
      }

      const history = await historyActors(orderId);
      expect(history.filter((h) => h.to_status === "accepted")).toHaveLength(1);
      expect(history.filter((h) => h.to_status === "preparing")).toHaveLength(1);
    } finally {
      await otherContext.close();
    }
  });

  test("a scheduled order waits in Upcoming, then moves to New and alerts when it falls due", async ({ page }) => {
    const user = await createCustomer("staff-scheduled");
    const cafe = must(await db().from("locations").select("prep_time_minutes").eq("slug", SEEDED.cafeSlug).single(), "cafe");
    // Due (pickup minus prep time) about 20 seconds from now.
    const scheduledFor = new Date(Date.now() + cafe.prep_time_minutes * 60_000 + 20_000);
    await openStaffQueue(page, BARISTA);
    const alert = page.getByTestId("new-order-alert");
    if (await alert.isVisible()) await alert.getByRole("button", { name: "Acknowledge" }).click();

    const { orderNumber } = await arrangePlacedOrder({ userId: user.id, cupName: "Iolani", scheduledFor, lines: [LATTE] });
    const upcoming = column(page, "upcoming").locator(`[data-order-number="${orderNumber}"]`);
    await expect(upcoming).toBeVisible({ timeout: 15_000 });
    await expect(upcoming.getByRole("button", { name: "Accept early" })).toBeVisible();
    const before = await alertCount(page);

    const now = column(page, "new").locator(`[data-order-number="${orderNumber}"]`);
    await expect(now).toBeVisible({ timeout: 35_000 });
    await expect(now).toHaveAttribute("data-unacknowledged", "true");
    await expect.poll(() => alertCount(page)).toBeGreaterThan(before);
    await expect(upcoming).toBeHidden();
  });

  test("ticket detail shows the history, and prints a ticket and one label per drink", async ({ page }) => {
    const user = await createCustomer("staff-print");
    const { orderId, orderNumber } = await arrangePlacedOrder({
      userId: user.id,
      cupName: "Pua",
      lines: [{ ...LATTE, quantity: 2 }, { productSlug: "cold-brew", sizeName: "Medium" }],
    });
    await forceStatus(orderId, ["accepted"]);
    await openStaffQueue(page, BARISTA);

    await ticket(page, orderNumber).getByRole("button", { name: /^Open order/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("detail-status")).toHaveText("Accepted");
    await expect(dialog.getByTestId("status-history")).toContainText("Placed");
    await expect(dialog.getByTestId("status-history")).toContainText("Payment confirmed");

    await dialog.getByRole("button", { name: "Print cup labels" }).click();
    await expect.poll(() => prints(page)).toEqual([{ kind: "labels", labels: 3 }]);
    await dialog.getByRole("button", { name: "Print ticket" }).click();
    await expect.poll(async () => (await prints(page)).length).toBe(2);
    expect((await prints(page))[1].kind).toBe("ticket");
  });
});

test.describe("cancel, sold out and pause @tablet", () => {
  test("cancelling a paid order with a reason refunds it, and the customer sees Refunded", async ({ page, browser, request }) => {
    const user = await createCustomer("staff-cancel");
    const arranged = await arrangePendingOrder({ userId: user.id, pay: "pm_card_visa" });
    expect((await deliver(request, fixtureEvent("payment_intent.succeeded", arranged.intent))).body.outcome).toBe("processed");
    const tracker = await openTracker(browser, user, arranged.orderId);

    try {
      await openStaffQueue(page, BARISTA);
      await ticket(page, arranged.orderNumber).getByRole("button", { name: /^Open order/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Cancel order" }).click();

      const confirm = dialog.getByRole("button", { name: /^Cancel and refund/ });
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel("Other").check();
      await expect(confirm).toBeDisabled();
      await dialog.getByLabel("Out of ingredient").check();
      await expect(dialog.getByTestId("refund-statement")).toContainText("refunds $6.12");
      await expect(confirm).toHaveText("Cancel and refund $6.12");
      await confirm.click();

      await expect(page.getByText(`Order ${arranged.orderNumber} cancelled`)).toBeVisible({ timeout: 20_000 });
      await expect(ticket(page, arranged.orderNumber)).toBeHidden();
      await expect(tracker.page.getByTestId("order-status").first()).toHaveText("Refunded", { timeout: 15_000 });
      await expect(tracker.page.getByTestId("order-outcome")).toContainText("Out of ingredient");
      await expectNotReloaded(tracker.page);

      const order = must(await db().from("orders").select("status, cancellation_reason").eq("id", arranged.orderId).single(), "order");
      expect(order).toEqual({ status: "refunded", cancellation_reason: "Out of ingredient" });
    } finally {
      await tracker.close();
    }
  });

  test("marking an item sold out shows on the customer menu and flags a cart holding it", async ({ page, browser }) => {
    const user = await createCustomer("staff-soldout");
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    try {
      await signIn(customer, user.email, user.password);
      await addFromMenu(customer, "Cold Brew");

      await openStaffQueue(page, BARISTA);
      await page.getByRole("button", { name: "Sold out", exact: true }).click();
      await page.getByPlaceholder(/Search drinks/).fill("Cold Brew");
      const row = page.getByTestId("sold-out-row").filter({ hasText: /^Cold Brew/ });
      await expect(page.getByLabel("Until end of day")).toBeChecked();
      await row.getByRole("button", { name: "Mark Cold Brew sold out" }).click();
      await expect(row).toHaveAttribute("data-sold-out", "true");
      await expect(row).toContainText("back tomorrow");

      await customer.goto("/menu");
      const card = customer.locator("article").filter({ has: customer.getByRole("link", { name: "Cold Brew", exact: true }) });
      await expect(card.getByText("Sold out")).toBeVisible();
      await customer.goto("/cart");
      await expect(customer.getByText(/Sold out at/)).toBeVisible({ timeout: 15_000 });
      await expect(customer.getByRole("button", { name: "Checkout" })).toBeDisabled();

      // Who did it is on record, with the end-of-day reset.
      const cafeId = await locationIdBySlug(SEEDED.cafeSlug);
      const product = must(await db().from("products").select("id").eq("slug", "cold-brew").single(), "cold brew");
      const flag = must(
        await db().from("location_availability").select("available_from").eq("location_id", cafeId).eq("product_id", product.id).single(),
        "flag",
      );
      expect(new Date(flag.available_from!).getTime()).toBeGreaterThan(Date.now());
      const log = must(
        await db().from("location_availability_log").select("action, actor").eq("product_id", product.id).order("created_at", { ascending: false }).limit(1).single(),
        "log",
      );
      const baristaId = must(await db().from("profiles").select("id").eq("email", BARISTA).single(), "barista").id;
      expect(log).toEqual({ action: "sold_out", actor: baristaId });

      // And back on.
      await row.getByRole("button", { name: "Mark Cold Brew available" }).click();
      await expect(row).toHaveAttribute("data-sold-out", "false");
      await customer.goto("/cart");
      // Checkout is a link once nothing blocks it.
      await expect(customer.getByRole("link", { name: /^Checkout/ })).toBeVisible({ timeout: 15_000 });
    } finally {
      await customerContext.close();
      await db().from("location_availability").delete().not("id", "is", null);
    }
  });

  test("pausing with an auto-resume blocks checkout, which works again once the time is up", async ({ page, browser }) => {
    const user = await createCustomer("staff-pause");
    const customerContext = await browser.newContext();
    const customer = await customerContext.newPage();
    const cafeId = await locationIdBySlug(SEEDED.cafeSlug);
    try {
      await signIn(customer, user.email, user.password);
      await addFromMenu(customer, "Latte");

      await openStaffQueue(page, BARISTA);
      await page.getByRole("button", { name: "Pause online orders" }).click();
      await page.getByRole("button", { name: "Pause 15 minutes" }).click();
      const banner = page.getByTestId("paused-banner");
      await expect(banner).toContainText("resuming automatically in 1");
      await expect(page.getByTestId("location-status")).toHaveText("Paused");

      const row = must(await db().from("locations").select("accepting_orders, paused_until").eq("id", cafeId).single(), "pause");
      expect(row.accepting_orders).toBe(false);
      const minutes = (new Date(row.paused_until!).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);

      await customer.goto("/cart");
      await expect(customer.getByText("Checkout isn't available right now")).toBeVisible();
      await expect(customer.getByRole("button", { name: "Checkout" })).toBeDisabled();

      // Fifteen minutes pass: the resume time arrives. Nothing flips the
      // column back; every reader treats a pause past its time as over.
      must(
        await db().from("locations").update({ paused_until: new Date(Date.now() - 1000).toISOString() }).eq("id", cafeId).select().single(),
        "time passes",
      );
      await customer.goto("/cart");
      // Checkout is a link once nothing blocks it.
      await expect(customer.getByRole("link", { name: /^Checkout/ })).toBeVisible({ timeout: 15_000 });
      await customer.goto("/checkout");
      await expect(customer.getByTestId("order-total")).toBeVisible({ timeout: 20_000 });
      await expect(customer.getByText(/paused online orders/)).toHaveCount(0);

      // The dashboard notices on its next check.
      await expect(banner).toBeHidden({ timeout: 25_000 });
      await expect(page.getByRole("button", { name: "Pause online orders" })).toBeVisible();
    } finally {
      await customerContext.close();
      await db().from("locations").update({ accepting_orders: true, paused_until: null, paused_at: null, paused_by: null }).eq("id", cafeId);
    }
  });

  test("taps made while offline fail with a message and change nothing", async ({ page, context }) => {
    const user = await createCustomer("staff-offline");
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, cupName: "Kalani", lines: [LATTE] });
    await openStaffQueue(page, BARISTA);
    await expect(ticket(page, orderNumber)).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByTestId("offline-banner")).toContainText("Offline — reconnecting…");
    await ticket(page, orderNumber).getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByText(/You're offline, so nothing was saved/)).toBeVisible();
    expect(must(await db().from("orders").select("status").eq("id", orderId).single(), "status").status).toBe("placed");

    await context.setOffline(false);
    await expect(page.getByTestId("offline-banner")).toBeHidden({ timeout: 30_000 });
    await ticket(page, orderNumber).getByRole("button", { name: "Accept", exact: true }).click();
    await expect(ticket(page, orderNumber).getByTestId("progress-badge")).toHaveText("Accepted");
  });
});

test.describe("access", () => {
  test("staff rostered only at the cafe can't open a pop-up's queue", async ({ page }) => {
    const restoreEvent = await makeEventLiveToday(SEEDED.eventSlug);
    try {
      const eventId = await locationIdBySlug(SEEDED.eventSlug);
      const cafeOnly = await createStaff("cafe-only", [SEEDED.cafeSlug]);
      const customer = await createCustomer("event-order");
      await arrangePlacedOrder({ userId: customer.id, locationSlug: SEEDED.eventSlug, lines: [{ productSlug: "cold-brew", sizeName: "Medium" }] });

      await signIn(page, cafeOnly.email, TEST_PASSWORD, "/staff");
      await expect(page.getByTestId("location-name")).toHaveText(/Kapiolani/);
      await expect(page.getByTestId("location-switcher")).toHaveCount(0);

      await page.goto(`/staff?location=${eventId}`);
      await expect(page.getByRole("heading", { name: "Not your counter" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start shift" })).toHaveCount(0);

      // The database agrees, whatever the page does.
      const client = await signedInClient(cafeOnly.email);
      const { data } = await client.from("orders").select("id").eq("location_id", eventId);
      expect(data).toEqual([]);
      const { error } = await client.rpc("set_location_accepting_orders", { target_location_id: eventId, accepting: false });
      expect(error?.code).toBe("42501");

      // The seeded barista works both counters and can switch.
      const barista = await signedInClient(BARISTA);
      expect((await barista.from("orders").select("id").eq("location_id", eventId)).data?.length).toBeGreaterThan(0);
    } finally {
      await restoreEvent();
    }
  });

  test("the cancel endpoint: staff of that location or admins only, with a reason", async ({ browser, baseURL }) => {
    const customer = await createCustomer("cancel-api");
    const cafeOnly = await createStaff("cancel-api", [SEEDED.cafeSlug]);
    const { orderId: eventOrder } = await arrangePlacedOrder({
      userId: customer.id,
      locationSlug: SEEDED.eventSlug,
      lines: [{ productSlug: "cold-brew", sizeName: "Medium" }],
    });
    const post = async (email: string | null, body: unknown, origin = baseURL!) => {
      const context = await browser.newContext();
      try {
        if (email) await signIn(await context.newPage(), email, TEST_PASSWORD, "/");
        return await context.request.post(`/api/staff/orders/${eventOrder}/cancel`, { data: body as object, headers: { origin } });
      } finally {
        await context.close();
      }
    };
    expect((await post(null, { reason: "Out of ingredient" })).status()).toBe(401);
    expect((await post(customer.email, { reason: "Out of ingredient" })).status()).toBe(403);
    expect((await post(cafeOnly.email, { reason: "Out of ingredient" })).status()).toBe(403);
    expect((await post(BARISTA, {})).status()).toBe(400);
    expect((await post(BARISTA, { reason: "  " })).status()).toBe(400);
    expect((await post(BARISTA, { reason: "Out of ingredient" }, "https://evil.example")).status()).toBe(400);
    expect(must(await db().from("orders").select("status").eq("id", eventOrder).single(), "order").status).toBe("placed");
  });

  test("on a phone the columns become tabs", async ({ page }) => {
    const user = await createCustomer("staff-phone");
    await openStaffQueue(page, BARISTA);
    const { orderNumber } = await arrangePlacedOrder({ userId: user.id, cupName: "Keoni", lines: [LATTE] });

    await expect(page.getByRole("tab", { name: /New/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: /In progress/ })).toBeVisible();
    // Only one column is on screen at a time.
    await expect(page.locator("[data-testid^=column-]:visible")).toHaveCount(1);
    const card = ticket(page, orderNumber).filter({ visible: true });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(card).toBeHidden();
    await page.getByRole("tab", { name: /In progress/ }).click();
    await expect(ticket(page, orderNumber).filter({ visible: true }).getByTestId("progress-badge")).toHaveText("Accepted");
    // Primary actions stay big enough for wet hands.
    const box = await ticket(page, orderNumber).filter({ visible: true }).getByRole("button", { name: "Start", exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(56);
  });
});

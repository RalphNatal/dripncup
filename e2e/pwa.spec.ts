/**
 * The installable app: the service worker's caching rules in a real
 * browser, the offline page and banner, the "new version" prompt, the
 * manifest, and "Your order is ready" as a Web Push (through the outbox,
 * to a stand-in push service; support/push.ts).
 */
import { expect, test, type Page } from "./support/test";

import { addFromMenu, signIn } from "./support/checkout";
import { SEEDED, createCustomer, db, must } from "./support/db";
import { arrangePlacedOrder, forceStatus } from "./support/orders";
import { decryptPush, fakeSubscription, startPushService, stubPushManager, type PushService } from "./support/push";

const LATTE = { productSlug: "latte" };
const CRON_SECRET = process.env.E2E_CRON_SECRET!;

/** The service worker controls the page (it claims clients on its first install). */
async function controlled(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20_000 });
}

/** Every URL the worker has stored, by cache. */
async function cachedPaths(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      out[name] = (await cache.keys()).map((request) => new URL(request.url).pathname);
    }
    return out;
  });
}

test.describe("service worker", () => {
  test("never stores checkout, account, orders, auth or API responses", async ({ page }) => {
    test.setTimeout(120_000);
    const user = await createCustomer("sw-cache");
    const { orderId } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    await page.goto("/menu");
    await controlled(page);

    await signIn(page, user.email, user.password, "/menu");
    await addFromMenu(page, "Latte");
    for (const path of ["/", "/menu", "/menu/latte", "/rewards", "/events", "/cart", "/checkout", "/account", "/orders", `/orders/${orderId}`]) {
      await page.goto(path);
      // Checkout never goes idle (Stripe keeps connections open).
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    }
    // A GET to the API from the page, through the worker (refused without the secret).
    await page.evaluate(() => fetch("/api/cron/send-emails").then((r) => r.status));

    const stored = await cachedPaths(page);
    const everything = Object.values(stored).flat();
    for (const never of [/^\/checkout/, /^\/cart/, /^\/account/, /^\/orders/, /^\/sign-in/, /^\/api\//, /^\/auth\//, /^\/admin/, /^\/staff/]) {
      expect(everything.filter((path) => never.test(path)), String(never)).toEqual([]);
    }
    expect(stored["drincup-pages-v1"]).toEqual(expect.arrayContaining(["/menu", "/menu/latte", "/rewards"]));
    expect(stored["drincup-static-v1"]?.length ?? 0).toBeGreaterThan(0);
    // Nothing from Supabase or Stripe, in any cache.
    const urls = await page.evaluate(async () =>
      (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((r) => r.url)))).flat(),
    );
    expect(urls.filter((url) => !url.startsWith("http://localhost:3100/"))).toEqual([]);
  });

  test("offline: the offline page, the last copy of a public page with the banner, ordering blocked", async ({ page, context }) => {
    const user = await createCustomer("sw-offline");
    await signIn(page, user.email, user.password, "/menu");
    await controlled(page);
    await addFromMenu(page, "Latte");
    await page.goto("/menu");
    await page.goto("/cart");
    await expect(page.getByRole("link", { name: /^Checkout/ })).toBeVisible();

    await context.setOffline(true);
    // Already on the cart: it stays, checking out waits for the connection.
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect to check out" })).toBeDisabled();

    // A page never stored: the offline page.
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await expect(page.getByText("Your cart is saved on this device.")).toBeVisible();
    await expect(page.getByText("Reconnect to place your order.")).toBeVisible();

    // A public page loaded before: its last copy, with the banner.
    await page.goto("/menu");
    await expect(page.getByRole("heading", { name: "Menu", level: 1 })).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toContainText("Offline");

    await context.setOffline(false);
    await page.goto("/cart");
    await expect(page.getByTestId("offline-banner")).toBeHidden();
    await expect(page.getByRole("link", { name: /^Checkout/ })).toBeVisible();
  });

  test("a new version: the prompt appears, checkout waits for it, Refresh switches to it", async ({ page }) => {
    const user = await createCustomer("sw-update");
    await signIn(page, user.email, user.password, "/menu");
    await controlled(page);
    await addFromMenu(page, "Latte");
    await page.goto("/checkout");
    await expect(page.getByTestId("order-total")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("update-prompt")).toBeHidden();

    // What a deploy does: a different worker script installs and waits.
    // (Registering under a new URL is how a test makes the browser install
    // one; a real deploy changes the script's bytes at the same URL.)
    await page.evaluate(() => navigator.serviceWorker.register("/serwist/sw.js?build=next", { scope: "/", updateViaCache: "none" }));
    await expect(page.getByTestId("update-prompt")).toContainText("A new version is available.");
    await expect(page.getByTestId("checkout-update")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay / })).toBeDisabled();
    await expect(page.getByText("We've just updated the app. Refresh to continue; your cart is saved.")).toBeVisible();

    await page.evaluate(() => ((window as unknown as { e2eBeforeRefresh: boolean }).e2eBeforeRefresh = true));
    await page.getByTestId("update-prompt").getByRole("button", { name: "Refresh" }).click();
    await page.waitForFunction(() => !(window as unknown as { e2eBeforeRefresh?: boolean }).e2eBeforeRefresh);
    await controlled(page);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain("build=next");
    // The cart survived the refresh.
    await expect(page.getByTestId("order-total")).toBeVisible({ timeout: 20_000 });
  });

  test("signing in never looks like a new version", async ({ page, request }) => {
    // Sign-in, sign-out and admin saves call revalidatePath("/", "layout"),
    // which reaches the worker's prerendered route too, and the server then
    // renders it again. That copy must be the build's, byte for byte, or
    // every browser would be told to refresh (and checkout would wait).
    const before = await (await request.get("/serwist/sw.js")).text();
    const user = await createCustomer("sw-same");
    await signIn(page, user.email, user.password, "/menu");
    await controlled(page);
    // The first request after a revalidation can still get the old copy while
    // the new one renders; the second gets the new one.
    expect(await (await request.get("/serwist/sw.js")).text()).toBe(before);
    await page.waitForTimeout(2000);
    expect(await (await request.get("/serwist/sw.js")).text()).toBe(before);

    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration?.update()));
    await page.waitForTimeout(1500);
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(false);
    await expect(page.getByTestId("update-prompt")).toHaveCount(0);
  });

  test("the manifest makes the app installable", async ({ request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({
      name: "Drincup Cafe",
      short_name: "Drincup",
      display: "standalone",
      start_url: "/",
      theme_color: "#1ab3c0",
    });
    expect(manifest.icons.map((icon: { purpose: string; sizes: string }) => `${icon.purpose} ${icon.sizes}`)).toEqual([
      "any 192x192",
      "any 512x512",
      "maskable 192x192",
      "maskable 512x512",
    ]);
    expect(manifest.shortcuts.map((s: { url: string }) => s.url)).toEqual(["/menu", "/orders", "/rewards"]);
    for (const icon of [...manifest.icons, ...manifest.shortcuts.flatMap((s: { icons: unknown[] }) => s.icons)]) {
      expect((await request.get(icon.src)).status(), icon.src).toBe(200);
    }
    const offline = await request.get("/offline");
    expect(offline.headers()["content-security-policy"]).toContain("default-src 'none'");
  });
});

test.describe("order ready push notifications", () => {
  let push: PushService;
  test.beforeAll(async () => {
    push = await startPushService();
  });
  test.afterAll(async () => {
    await push.close();
  });

  async function sweep(page: Page) {
    const response = await page.request.get("/api/cron/send-emails", { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(response.status()).toBe(200);
    return (await response.json()) as { push: { sent: number; removed: number } };
  }

  test("turned on from the tracker; Ready sends one push through the outbox; a dead device is removed", async ({ page, context }) => {
    const user = await createCustomer("push");
    const phone = fakeSubscription(push.origin, `live-${Date.now()}`);
    await stubPushManager(context, phone);
    const { orderId, orderNumber } = await arrangePlacedOrder({ userId: user.id, lines: [LATTE] });
    const cafe = must(await db().from("locations").select("name").eq("slug", SEEDED.cafeSlug).single(), "cafe");

    await signIn(page, user.email, user.password, `/orders/${orderId}`);
    await page.getByRole("button", { name: "Notify me when it's ready" }).click();
    await expect(page.getByText("We'll notify you when it's ready, even if you close the app.")).toBeVisible();

    const saved = must(await db().from("push_subscriptions").select("id, endpoint, device_label").eq("user_id", user.id), "subscriptions");
    expect(saved).toEqual([{ id: expect.any(String), endpoint: phone.endpoint, device_label: expect.stringMatching(/ on /) }]);

    // A second device whose app has since been uninstalled.
    const deadEndpoint = `${push.origin}/push/dead-${Date.now()}`;
    const dead = fakeSubscription(push.origin, "unused");
    must(
      await db().rpc("save_push_subscription", { p_user_id: user.id, p_endpoint: deadEndpoint, p_p256dh: dead.p256dh, p_auth: dead.auth, p_device_label: "Old phone" }),
      "dead device",
    );

    await forceStatus(orderId, ["accepted", "preparing"]);
    expect(must(await db().from("push_outbox").select("id").eq("order_id", orderId), "outbox")).toHaveLength(0);
    await forceStatus(orderId, ["ready"]);
    expect(must(await db().from("push_outbox").select("kind, status").eq("order_id", orderId), "outbox")).toEqual([
      { kind: "order_ready", status: "pending" },
    ]);

    const report = await sweep(page);
    expect(report.push.sent).toBe(1);
    expect(report.push.removed).toBe(1);

    // Exactly one push reached the phone: encrypted, signed, and saying the right thing.
    const delivered = push.to(new URL(phone.endpoint).pathname);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].headers["content-encoding"]).toBe("aes128gcm");
    expect(delivered[0].headers.authorization).toMatch(/^vapid t=.+, k=.+/);
    expect(delivered[0].headers.ttl).toBe("1800");
    expect(delivered[0].body.toString("utf8")).not.toContain(orderNumber);
    expect(decryptPush(delivered[0].body, phone)).toEqual({
      title: "Your order is ready! 🎉",
      body: `${orderNumber} is waiting for you at ${cafe.name}. Mahalo!`,
      tag: `order-ready-${orderId}`,
      url: `/orders/${orderId}`,
    });

    // The dead device was tried once and removed; the live one stays.
    expect(push.to(new URL(deadEndpoint).pathname)).toHaveLength(1);
    expect(must(await db().from("push_subscriptions").select("endpoint").eq("user_id", user.id), "after").map((s) => s.endpoint)).toEqual([phone.endpoint]);
    expect(must(await db().from("push_outbox").select("status").eq("order_id", orderId).single(), "row").status).toBe("sent");

    // A second sweep, or Ready again, sends nothing more.
    await forceStatus(orderId, ["ready"]);
    await sweep(page);
    expect(push.to(new URL(phone.endpoint).pathname)).toHaveLength(1);
  });

  test("managed in Account → Notifications, and forgotten on sign-out", async ({ page, context }) => {
    const user = await createCustomer("push-account");
    const phone = fakeSubscription(push.origin, `acct-${Date.now()}`);
    await stubPushManager(context, phone);
    const laptop = fakeSubscription(push.origin, `laptop-${Date.now()}`);
    must(
      await db().rpc("save_push_subscription", { p_user_id: user.id, p_endpoint: laptop.endpoint, p_p256dh: laptop.p256dh, p_auth: laptop.auth, p_device_label: "Firefox on Windows" }),
      "laptop",
    );

    await signIn(page, user.email, user.password, "/account");
    const section = page.locator("#notifications");
    await section.getByRole("button", { name: "Turn on notifications" }).click();
    await expect(section.getByText(/^On\. We'll tell you when your order is ready/)).toBeVisible();
    await expect.poll(async () => (await db().from("push_subscriptions").select("id").eq("user_id", user.id)).data?.length).toBe(2);

    // The other device is listed and can be removed.
    await page.reload();
    await section.getByRole("button", { name: /^Remove Firefox on Windows/ }).click();
    await expect(section.getByTestId("push-devices")).toBeHidden();
    await expect.poll(async () => (await db().from("push_subscriptions").select("endpoint").eq("user_id", user.id)).data?.map((s) => s.endpoint)).toEqual([
      phone.endpoint,
    ]);

    // Off, then on again, then signing out forgets this device.
    await section.getByRole("button", { name: "Turn off" }).click();
    await expect(section.getByRole("button", { name: "Turn on notifications" })).toBeVisible();
    await expect.poll(async () => (await db().from("push_subscriptions").select("id").eq("user_id", user.id)).data?.length).toBe(0);
    await section.getByRole("button", { name: "Turn on notifications" }).click();
    await expect.poll(async () => (await db().from("push_subscriptions").select("id").eq("user_id", user.id)).data?.length).toBe(1);

    await page.reload();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/");
    await expect.poll(async () => (await db().from("push_subscriptions").select("id").eq("user_id", user.id)).data?.length).toBe(0);
  });
});

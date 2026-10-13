/**
 * Security headers on the real server. Every other spec runs under the page
 * guard, which fails on any Content Security Policy violation, so checkout
 * (Stripe's card form, 3-D Secure, wallets), Realtime, images and the
 * service worker are all checked against the policy as they run. These tests
 * pin the policy itself down.
 */
import { expect, test } from "./support/test";

test.describe("Content Security Policy", () => {
  test("every page gets a fresh nonce, and the page's scripts carry it", async ({ page, request }) => {
    const first = await request.get("/menu");
    const second = await request.get("/menu");
    const csp = first.headers()["content-security-policy"];
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(second.headers()["content-security-policy"]).not.toContain(nonce!);
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    expect(first.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const html = await first.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, tag).toContain(`nonce="${nonce}"`);

    // And the page runs under it (the guard fails on any violation): searching is client-side.
    await page.goto("/menu");
    await page.getByRole("searchbox").fill("zzzz-nothing");
    await expect(page.getByText(/No matches for/)).toBeVisible();
  });

  test("the built-in 404 page is rendered per request, so its scripts run", async ({ page, request }) => {
    const response = await request.get("/no-such-page");
    expect(response.status()).toBe(404);
    const nonce = response.headers()["content-security-policy"]?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(await response.text()).toContain(`nonce="${nonce}"`);
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "We couldn't find that page" })).toBeVisible();
  });

  test.describe("blocks injected script", () => {
    // This test provokes the violation on purpose.
    test.use({ allowedPageErrors: [/Content Security Policy|Refused to/] });

    test("an inline event handler injected into the page never runs", async ({ page }) => {
      const violations: string[] = [];
      page.on("console", (message) => {
        if (/Content Security Policy/.test(message.text())) violations.push(message.text());
      });
      await page.goto("/menu");
      await page.evaluate(() => {
        // What an HTML injection would add: an inline handler and a javascript: link.
        // (Scripts added through the DOM API are trusted under 'strict-dynamic'
        // by design; it is injected markup the policy stops.)
        document.body.insertAdjacentHTML("beforeend", '<img src="/no-such-image.png" onerror="window.__xss = true">');
        document.body.insertAdjacentHTML("beforeend", '<a id="xss-link" href="javascript:window.__xss2 = true">x</a>');
        document.getElementById("xss-link")!.click();
      });
      await page.waitForTimeout(1000);
      expect(await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss)).toBeUndefined();
      expect(await page.evaluate(() => (window as unknown as { __xss2?: boolean }).__xss2)).toBeUndefined();
      expect(violations.length).toBeGreaterThan(0);
    });
  });
});

test("security headers on every response", async ({ request }) => {
  for (const path of ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/offline", "/robots.txt"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["permissions-policy"], path).toContain("camera=()");
    // The suite serves a production build, which sends HSTS (browsers ignore it over plain http).
    expect(headers["strict-transport-security"], path).toBe("max-age=63072000; includeSubDomains");
  }
  const worker = (await request.get("/serwist/sw.js")).headers();
  expect(worker["cache-control"]).toContain("no-cache");
  expect(worker["service-worker-allowed"]).toBe("/");
});

test("robots.txt and the sitemap keep private pages out", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  for (const path of ["/admin", "/staff", "/account", "/orders", "/checkout", "/cart"]) expect(robots).toContain(`Disallow: ${path}`);
  expect(robots).toContain("Sitemap: ");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
  expect(urls).toEqual(expect.arrayContaining(["/", "/menu", "/rewards", "/events", "/catering", "/menu/latte"]));
  expect(urls.filter((path) => /^\/(admin|staff|account|orders|checkout|cart)(\/|$)/.test(path))).toEqual([]);
});

test("the home page describes the cafe for search engines", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const block = html.match(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/)?.[1];
  expect(block).toBeTruthy();
  const data = JSON.parse(block!);
  expect(data).toMatchObject({
    "@type": "CafeOrCoffeeShop",
    name: "Drincup Cafe",
    address: { "@type": "PostalAddress", addressLocality: "Honolulu", addressRegion: "HI" },
  });
  expect(data.openingHoursSpecification.length).toBeGreaterThan(0);
  expect(html).toMatch(/<link rel="canonical" href="https?:\/\/[^"/]+\/?"/);
  expect(html).toMatch(/<meta property="og:image" content="[^"]+opengraph-image/);
});

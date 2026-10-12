import { describe, expect, it } from "vitest";

import { cacheRuleFor, isNeverCached, type RequestLike } from "./cache-rules";

const ORIGIN = "https://order.drincup.example";

function request(path: string, init: Partial<RequestLike> & { headers?: Record<string, string> } = {}): RequestLike {
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url: path.startsWith("http") ? path : `${ORIGIN}${path}`,
    method: init.method ?? "GET",
    mode: init.mode,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
  };
}

const page = (path: string) => cacheRuleFor(request(path, { mode: "navigate" }), ORIGIN);

describe("service worker cache rules", () => {
  it("keeps public pages for offline", () => {
    for (const path of ["/", "/menu", "/menu/latte", "/rewards", "/events", "/events/kakaako-night-market", "/collections/summer-sunset", "/catering", "/about", "/privacy", "/terms", "/accessibility"]) {
      expect(page(path), path).toBe("pages");
    }
  });

  it("never stores checkout, payments, auth, account, staff, admin or API pages", () => {
    for (const path of [
      "/checkout",
      "/cart",
      "/orders",
      "/orders/0b0c3a8e-6b1e-4f9e-a1f3-2d4c5e6f7a8b",
      "/orders/0b0c3a8e-6b1e-4f9e-a1f3-2d4c5e6f7a8b/confirmed",
      "/account",
      "/account/favorites",
      "/account/catering/abc",
      "/catering/abc/pay",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/auth/callback",
      "/staff",
      "/admin",
      "/admin/reports",
      "/api/webhooks/stripe",
      "/api/cron/expire-orders",
      "/api/push/subscriptions",
    ]) {
      expect(page(path), path).toBe("network-only");
      expect(cacheRuleFor(request(path), ORIGIN), `${path} (fetch)`).toBe("ignore");
    }
  });

  it("an unknown page is never stored either (allow-list, not deny-list)", () => {
    expect(page("/something-new")).toBe("network-only");
  });

  it("never touches another origin: Supabase, Stripe", () => {
    expect(cacheRuleFor(request("https://abc.supabase.co/rest/v1/orders"), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("https://abc.supabase.co/storage/v1/object/public/product-images/a.webp"), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("https://api.stripe.com/v1/payment_intents"), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("https://js.stripe.com/v3/", { mode: "navigate" }), ORIGIN)).toBe("ignore");
  });

  it("never touches anything but GET (Server Actions, forms)", () => {
    expect(cacheRuleFor(request("/menu", { method: "POST", mode: "navigate" }), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("/checkout", { method: "POST", headers: { "Next-Action": "abc" } }), ORIGIN)).toBe("ignore");
  });

  it("never caches React Server Component requests or prefetches, even for public pages", () => {
    expect(cacheRuleFor(request("/menu", { headers: { RSC: "1" } }), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("/menu?_rsc=abc12"), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("/menu", { headers: { "Next-Router-Prefetch": "1", RSC: "1" } }), ORIGIN)).toBe("ignore");
  });

  it("caches hashed static files, fonts and menu images", () => {
    expect(cacheRuleFor(request("/_next/static/chunks/abc123.js"), ORIGIN)).toBe("static");
    expect(cacheRuleFor(request("/_next/static/media/font.p.woff2"), ORIGIN)).toBe("static");
    expect(cacheRuleFor(request("/_next/image?url=https%3A%2F%2Fx.supabase.co%2Fa.webp&w=640&q=75"), ORIGIN)).toBe("images");
    expect(cacheRuleFor(request("/icons/icon-192.png"), ORIGIN)).toBe("images");
  });

  it("leaves the worker, the offline page and the manifest to the browser", () => {
    expect(cacheRuleFor(request("/serwist/sw.js"), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("/offline"), ORIGIN)).toBe("ignore");
    expect(cacheRuleFor(request("/manifest.webmanifest"), ORIGIN)).toBe("ignore");
  });

  it("isNeverCached matches whole path segments only", () => {
    expect(isNeverCached("/admin")).toBe(true);
    expect(isNeverCached("/administrator-of-fun")).toBe(false);
    expect(isNeverCached("/catering")).toBe(false);
    expect(isNeverCached("/catering/123/pay")).toBe(true);
  });
});

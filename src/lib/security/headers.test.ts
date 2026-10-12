import { describe, expect, it } from "vitest";

import { PERMISSIONS_POLICY, buildCsp, newNonce, staticSecurityHeaders } from "./headers";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

const base = { nonce: "abc123==", dev: false, supabaseUrl: "https://xyz.supabase.co", siteUrl: "https://order.drincup.example" };

describe("Content Security Policy", () => {
  it("allows scripts only with this request's nonce (plus what they load), never inline or eval in production", () => {
    const script = directives(buildCsp(base)).get("script-src")!;
    expect(script).toContain("'nonce-abc123=='");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("allows eval only under next dev", () => {
    expect(directives(buildCsp({ ...base, dev: true })).get("script-src")).toContain("'unsafe-eval'");
  });

  it("lets Supabase's REST, Auth and Realtime websocket through, and its Storage images", () => {
    const csp = directives(buildCsp(base));
    expect(csp.get("connect-src")).toEqual(expect.arrayContaining(["'self'", "https://xyz.supabase.co", "wss://xyz.supabase.co"]));
    expect(csp.get("img-src")).toContain("https://xyz.supabase.co");
    const local = directives(buildCsp({ ...base, supabaseUrl: "http://127.0.0.1:54321" }));
    expect(local.get("connect-src")).toEqual(expect.arrayContaining(["http://127.0.0.1:54321", "ws://127.0.0.1:54321"]));
  });

  it("frames only Stripe (card form, wallets, 3-D Secure) and lets its API through", () => {
    const csp = directives(buildCsp(base));
    expect(csp.get("frame-src")).toEqual(["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"]);
    expect(csp.get("connect-src")).toContain("https://api.stripe.com");
    expect(csp.get("script-src")).toContain("https://js.stripe.com");
  });

  it("nobody may frame us; no plugins, no <base>, forms post only to us", () => {
    const csp = directives(buildCsp(base));
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("worker-src")).toEqual(["'self'"]);
  });

  it("upgrades insecure requests only on an https site (local http testing keeps working)", () => {
    expect(buildCsp(base)).toContain("upgrade-insecure-requests");
    expect(buildCsp({ ...base, siteUrl: "http://localhost:3000" })).not.toContain("upgrade-insecure-requests");
  });

  it("nonces are random and long enough", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});

describe("static security headers", () => {
  it("sets nosniff, a referrer policy, frame denial and a permissions policy everywhere", () => {
    const headers = Object.fromEntries(staticSecurityHeaders({ production: false }).map((h) => [h.key, h.value]));
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds HSTS in production", () => {
    const headers = Object.fromEntries(staticSecurityHeaders({ production: true }).map((h) => [h.key, h.value]));
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains");
  });

  it("the permissions policy switches off what we don't use and keeps what we do", () => {
    const features = new Map(PERMISSIONS_POLICY.split(", ").map((entry) => entry.split("=") as [string, string]));
    for (const off of ["camera", "microphone", "geolocation", "usb"]) expect(features.get(off), off).toBe("()");
    expect(features.get("screen-wake-lock")).toBe("(self)");
    expect(features.get("fullscreen")).toBe("(self)");
    expect(features.get("payment")).toBe('(self "https://js.stripe.com")');
  });
});

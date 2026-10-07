import { describe, expect, it } from "vitest";

import { findRouteRule, isGuestOnlyRoute, roleCanAccess } from "./roles";

describe("route rules", () => {
  it("leaves the storefront public", () => {
    for (const path of ["/", "/menu", "/rewards", "/sign-in", "/auth/callback"]) {
      expect(findRouteRule(path)).toBeNull();
    }
  });

  it("matches whole path segments, not string prefixes", () => {
    expect(findRouteRule("/admin/menu")?.prefix).toBe("/admin");
    expect(findRouteRule("/administrator")).toBeNull();
    expect(findRouteRule("/staffing")).toBeNull();
  });

  it("keeps /catering, /events and /collections public, but paying for a quote needs an account", () => {
    for (const path of ["/catering", "/events", "/events/kakaako", "/collections/summer-sunset"]) {
      expect(findRouteRule(path)).toBeNull();
    }
    expect(findRouteRule("/catering/123/pay")?.prefix).toBe("/catering/");
    expect(roleCanAccess("customer", "/catering/123/pay")).toBe(true);
    expect(findRouteRule("/cateringx")).toBeNull();
  });

  it("keeps customers out of staff and admin areas", () => {
    expect(roleCanAccess("customer", "/staff")).toBe(false);
    expect(roleCanAccess("customer", "/admin/reports")).toBe(false);
    expect(roleCanAccess("customer", "/account")).toBe(true);
    expect(roleCanAccess("customer", "/menu")).toBe(true);
  });

  it("lets staff into the queue but not admin", () => {
    expect(roleCanAccess("staff", "/staff")).toBe(true);
    expect(roleCanAccess("staff", "/admin")).toBe(false);
  });

  it("lets admins in everywhere", () => {
    for (const path of ["/admin", "/staff", "/account", "/orders", "/checkout"]) {
      expect(roleCanAccess("admin", path)).toBe(true);
    }
  });

  it("flags the sign-in and sign-up pages as guest-only", () => {
    expect(isGuestOnlyRoute("/sign-in")).toBe(true);
    expect(isGuestOnlyRoute("/sign-up")).toBe(true);
    expect(isGuestOnlyRoute("/forgot-password")).toBe(false);
    expect(isGuestOnlyRoute("/sign-industry")).toBe(false);
  });
});

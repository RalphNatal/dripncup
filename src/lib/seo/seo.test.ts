import { describe, expect, it } from "vitest";

import { DISALLOWED_PATHS, isDisallowed } from "./robots";
import { cafeStructuredData, jsonLd, openingHours } from "./structured-data";

describe("structured data", () => {
  it("groups days with the same hours, Sunday first, and never says 24:00", () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((day) => ({ day_of_week: day, opens_at: "07:00:00", closes_at: "18:00:00" })),
      { day_of_week: 6, opens_at: "08:00:00", closes_at: "24:00:00" },
      { day_of_week: 0, opens_at: "08:00:00", closes_at: "24:00:00" },
    ];
    expect(openingHours(rows)).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Sunday", "Saturday"], opens: "08:00", closes: "23:59" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "07:00", closes: "18:00" },
    ]);
  });

  it("describes the cafe with its address, contact and links", () => {
    const data = cafeStructuredData({
      siteUrl: "https://order.drincup.example/",
      hours: [{ day_of_week: 1, opens_at: "07:00:00", closes_at: "18:00:00" }],
      phone: "(808) 555-0123",
      sameAs: ["https://www.instagram.com/drincupcafe"],
    });
    expect(data).toMatchObject({
      "@type": "CafeOrCoffeeShop",
      name: "Drincup Cafe",
      url: "https://order.drincup.example/",
      hasMenu: "https://order.drincup.example/menu",
      telephone: "(808) 555-0123",
      sameAs: ["https://www.instagram.com/drincupcafe"],
      address: { streetAddress: "1221 Kapiolani Blvd, Site 112A", addressLocality: "Honolulu", addressRegion: "HI", postalCode: "96814" },
    });
    expect(data).not.toHaveProperty("email");
  });

  it("JSON-LD can't close its own script tag", () => {
    expect(jsonLd({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});

describe("robots", () => {
  it("keeps every private area out of search, and the public pages in", () => {
    for (const path of ["/admin", "/admin/orders", "/staff", "/account/favorites", "/orders/abc", "/checkout", "/cart", "/catering/abc/pay", "/api/push/subscriptions"]) {
      expect(isDisallowed(path), path).toBe(true);
    }
    for (const path of ["/", "/menu", "/menu/latte", "/rewards", "/events", "/catering", "/about", "/accessibility"]) {
      expect(isDisallowed(path), path).toBe(false);
    }
    expect(DISALLOWED_PATHS).toEqual(expect.arrayContaining(["/admin", "/staff", "/account", "/orders", "/checkout", "/cart"]));
  });
});

import { describe, expect, it } from "vitest";

import { productImageUrl, publicStorageUrl, safeCssColor } from "./images";
import { matchesSearch, normalizeForSearch } from "./search";

describe("menu search", () => {
  it("ignores case, accents and the ʻokina", () => {
    expect(normalizeForSearch("Lilikoʻi Lemonade")).toBe("lilikoi lemonade");
    expect(normalizeForSearch("Kona Coffee Frappé")).toBe("kona coffee frappe");
    expect(normalizeForSearch("Kakaʻako  Pop-Up")).toBe("kakaako pop-up");
  });

  it("finds a Hawaiian name typed on a plain keyboard", () => {
    expect(matchesSearch("lilikoi", ["Lilikoʻi Lemonade", null])).toBe(true);
    expect(matchesSearch("lilikoʻi", ["Passion fruit", "with lilikoi"])).toBe(true);
  });

  it("searches the description too, and needs every word", () => {
    expect(matchesSearch("steeped chocolatey", ["Cold Brew", "Steeped 18 hours for a chocolatey cup."])).toBe(true);
    expect(matchesSearch("steeped mango", ["Cold Brew", "Steeped 18 hours."])).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesSearch("   ", ["Latte"])).toBe(true);
  });
});

describe("product image URLs", () => {
  it("turns a bucket path into a public Storage URL", () => {
    expect(productImageUrl("drinks/pog refresher.webp", "http://127.0.0.1:54321/")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/product-images/drinks/pog%20refresher.webp",
    );
  });

  it("keeps full URLs into this project's public Storage, and nothing else", () => {
    const supabase = "https://p.supabase.co";
    const own = "https://p.supabase.co/storage/v1/object/public/product-images/a.png";
    expect(productImageUrl(own, supabase)).toBe(own);
    expect(productImageUrl("https://x.test/a.png", supabase)).toBeNull();
    expect(productImageUrl("https://p.supabase.co/storage/v1/object/sign/private/a.png", supabase)).toBeNull();
    expect(productImageUrl("https://p.supabase.co.evil.test/storage/v1/object/public/a.png", supabase)).toBeNull();
  });

  it("ignores blanks", () => {
    expect(productImageUrl("  ", "http://s")).toBeNull();
    expect(productImageUrl(null, "http://s")).toBeNull();
  });

  it("strips leading slashes from paths", () => {
    expect(publicStorageUrl("https://p.supabase.co", "b", "/a.png")).toBe(
      "https://p.supabase.co/storage/v1/object/public/b/a.png",
    );
  });
});

describe("collection accent colours", () => {
  it("accepts ordinary colour values", () => {
    for (const color of ["#E0409B", "#fff", "rgb(224, 64, 155)", "oklch(0.6 0.2 350)", "teal", " #0e7c86 "]) {
      expect(safeCssColor(color), color).toBe(color.trim());
    }
  });

  it("drops anything that could smuggle in other CSS", () => {
    for (const color of [
      "red; background: url(https://evil.test/x.png)",
      "url(https://evil.test)",
      "var(--x)",
      "expression(alert(1))",
      "#12345",
      "",
    ]) {
      expect(safeCssColor(color), color).toBeNull();
    }
    expect(safeCssColor(null)).toBeNull();
  });
});

import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { BRAND_COLORS } from "@/lib/brand";
import { parseClientEnv } from "@/lib/env-parse";

import { OFFLINE_PAGE_CSP, offlinePageHtml } from "./offline-page";
import { SPLASH_SCREENS, splashImages } from "./splash-screens";

describe("brand colours", () => {
  it("BRAND_COLORS match the --brand-* tokens in globals.css (one palette, two copies)", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const token = (name: string) => css.match(new RegExp(`--brand-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1]?.toLowerCase();
    const names: Record<keyof typeof BRAND_COLORS, string> = {
      teal: "teal",
      tealDeep: "teal-deep",
      tealSoft: "teal-soft",
      pink: "pink",
      pinkSoft: "pink-soft",
      magenta: "magenta",
      magentaDeep: "magenta-deep",
      ink: "ink",
      sand: "sand",
    };
    for (const [key, cssName] of Object.entries(names)) {
      expect(token(cssName), `--brand-${cssName}`).toBe(BRAND_COLORS[key as keyof typeof BRAND_COLORS]);
    }
  });
});

describe("generated brand files", () => {
  it("every file the manifest and layout link exists (npm run brand:assets)", () => {
    for (const file of [
      "public/icons/icon-192.png",
      "public/icons/icon-512.png",
      "public/icons/icon-maskable-192.png",
      "public/icons/icon-maskable-512.png",
      "public/icons/badge-96.png",
      "public/icons/shortcut-menu.png",
      "public/icons/shortcut-orders.png",
      "public/icons/shortcut-rewards.png",
      "src/app/apple-icon.png",
      "src/app/favicon.ico",
      "src/app/opengraph-image.png",
      "src/app/twitter-image.png",
      ...splashImages().map((image) => `public${image.url}`),
    ]) {
      expect(existsSync(file), file).toBe(true);
    }
  });
});

describe("iOS launch screens", () => {
  it("one image per screen size and orientation, with an exact media query", () => {
    const images = splashImages();
    expect(images).toHaveLength(SPLASH_SCREENS.length + SPLASH_SCREENS.filter((s) => s.landscape).length);
    expect(new Set(images.map((i) => i.url)).size).toBe(images.length);
    const iphone = images.find((i) => i.url === "/splash/apple-splash-1170x2532.png");
    expect(iphone?.media).toBe(
      "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
    );
    const ipadLandscape = images.find((i) => i.url === "/splash/apple-splash-2732x2048.png");
    expect(ipadLandscape?.media).toContain("(device-width: 1024px) and (device-height: 1366px)");
    expect(ipadLandscape?.media).toContain("(orientation: landscape)");
  });
});

describe("offline page", () => {
  it("says the cart is safe and how to order, with no scripts at all", () => {
    const html = offlinePageHtml();
    expect(html).toContain("You're offline");
    expect(html).toContain("Your cart is saved on this device.");
    expect(html).toContain("Reconnect to place your order.");
    expect(html).toContain('<html lang="en">');
    expect(html).not.toMatch(/<script/i);
    expect(OFFLINE_PAGE_CSP).toContain("default-src 'none'");
    expect(OFFLINE_PAGE_CSP).not.toContain("script-src");
  });
});

describe("public environment", () => {
  const valid = {
    NEXT_PUBLIC_SUPABASE_URL: " http://127.0.0.1:54321 ",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    NEXT_PUBLIC_SITE_URL: undefined,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "",
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BPub",
  };

  it("trims, defaults the site URL and treats blanks as unset", () => {
    const result = parseClientEnv(valid);
    expect(result).toEqual({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: undefined,
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: "BPub",
      },
    });
  });

  it("names what is missing or wrong", () => {
    const result = parseClientEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "127.0.0.1", NEXT_PUBLIC_SUPABASE_ANON_KEY: " " });
    expect("problems" in result && result.problems).toEqual([
      expect.stringContaining("NEXT_PUBLIC_SUPABASE_URL"),
      expect.stringContaining("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    ]);
  });
});

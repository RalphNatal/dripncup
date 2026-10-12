import type { MetadataRoute } from "next";

import { BRAND, BRAND_COLORS } from "@/lib/brand";

/**
 * The web app manifest (/manifest.webmanifest): what makes the app
 * installable. Icons are drawn by `npm run brand:assets` from brand/logo.svg;
 * colours are the brand tokens. Shortcuts appear on a long press of the
 * home-screen icon (Android, desktop).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: `${BRAND.taglines.secondary} Order ahead for pickup in Honolulu.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    // No `orientation`: locking it would fail WCAG 1.3.4 (tablets are used sideways).
    lang: "en-US",
    dir: "ltr",
    theme_color: BRAND_COLORS.teal,
    background_color: BRAND_COLORS.sand,
    categories: ["food", "shopping", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Menu", short_name: "Menu", description: "Start an order", url: "/menu", icons: [{ src: "/icons/shortcut-menu.png", sizes: "96x96", type: "image/png" }] },
      { name: "Orders", short_name: "Orders", description: "Track your order", url: "/orders", icons: [{ src: "/icons/shortcut-orders.png", sizes: "96x96", type: "image/png" }] },
      {
        name: BRAND.loyaltyProgramName,
        short_name: "Rewards",
        description: "Your points and rewards",
        url: "/rewards",
        icons: [{ src: "/icons/shortcut-rewards.png", sizes: "96x96", type: "image/png" }],
      },
    ],
  };
}

import type { Metadata, Viewport } from "next";
import { Baloo_2, Inter } from "next/font/google";
import { connection } from "next/server";

import { Providers } from "@/components/providers";
import { TestModeBanner } from "@/components/test-mode-banner";
import { BRAND, BRAND_COLORS, CAFE_ADDRESS, CAFE_ADDRESS_ONE_LINE } from "@/lib/brand";
import { clientEnv } from "@/lib/env";
import { splashImages } from "@/lib/pwa/splash-screens";
import { storeAlwaysOpen } from "@/lib/test-mode";

import "./globals.css";

/**
 * Baloo 2 for headings, Inter for body, both variable fonts. Every subset
 * is declared (with its unicode-range) whatever `subsets` says; `subsets`
 * only picks what is preloaded. `latin` carries the okina (U+02BB) and the
 * combining macron; the precomposed kahako vowels (ā ē ī ō ū) are in
 * `latin-ext`, which the browser fetches by itself the first time a page
 * shows one, rather than every page paying for it up front.
 */
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(clientEnv.NEXT_PUBLIC_SITE_URL),
  title: {
    default: `${BRAND.name} — ${BRAND.taglines.primary}`,
    template: `%s · ${BRAND.name}`,
  },
  description: `${BRAND.taglines.secondary} Order ahead for pickup at ${CAFE_ADDRESS.line1}, ${CAFE_ADDRESS.city}.`,
  applicationName: BRAND.name,
  keywords: ["Honolulu cafe", "order ahead", "coffee", "shave ice", "Kapiolani"],
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    title: `${BRAND.name} — ${BRAND.taglines.primary}`,
    description: BRAND.taglines.secondary,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.taglines.primary}`,
    description: BRAND.taglines.secondary,
  },
  // The manifest, favicon, Apple touch icon and share images come from file
  // conventions in src/app (drawn by `npm run brand:assets`).
  appleWebApp: {
    capable: true,
    title: BRAND.shortName,
    statusBarStyle: "default",
    startupImage: splashImages().map((image) => ({ url: image.url, media: image.media })),
  },
  formatDetection: { telephone: true, address: false },
  other: { "og:street-address": CAFE_ADDRESS_ONE_LINE },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled; disabling it fails WCAG 1.4.4.
  maximumScale: 5,
  themeColor: BRAND_COLORS.teal,
  // Content may sit under the notch only where it pads itself (pt-safe, pb-safe).
  viewportFit: "cover",
};

/**
 * Rendered per request, never prerendered: the Content Security Policy's
 * nonce (src/proxy.ts) only reaches scripts in HTML made for that request.
 * Every page already was dynamic (they read the session); this also covers
 * the built-in 404 page, which would otherwise be static HTML whose scripts
 * the policy blocks.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="en" className={`${inter.variable} ${baloo.variable} h-full`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {/* Local test mode only; the guard makes this impossible in a production build. */}
        {storeAlwaysOpen() ? <TestModeBanner /> : null}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

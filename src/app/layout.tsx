import type { Metadata, Viewport } from "next";
import { Baloo_2, Inter } from "next/font/google";

import { Providers } from "@/components/providers";
import { TestModeBanner } from "@/components/test-mode-banner";
import { BRAND, CAFE_ADDRESS, CAFE_ADDRESS_ONE_LINE } from "@/lib/brand";
import { clientEnv } from "@/lib/env";
import { storeAlwaysOpen } from "@/lib/test-mode";

import "./globals.css";

/**
 * Baloo 2 for headings, Inter for body. Both are loaded with `latin-ext`, which
 * carries the combining macron used for kahako; the okina is an ASCII-safe
 * U+02BB that both faces cover.
 */
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
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
  // The full PWA manifest and icon set land in Phase 10.
  formatDetection: { telephone: true, address: false },
  other: { "og:street-address": CAFE_ADDRESS_ONE_LINE },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled; disabling it fails WCAG 1.4.4.
  maximumScale: 5,
  themeColor: "#1AB3C0",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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

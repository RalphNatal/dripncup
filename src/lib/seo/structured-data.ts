/**
 * schema.org structured data for search engines: the cafe as a
 * CafeOrCoffeeShop, with its address, opening hours (from the database, so
 * the admin's hours are what Google shows), contact details and links. Pure;
 * the home and About pages render it as JSON-LD.
 */
import { BRAND, CAFE_ADDRESS } from "@/lib/brand";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export interface HoursRow {
  /** 0 = Sunday, as in the database. */
  day_of_week: number;
  /** "07:00:00" */
  opens_at: string;
  closes_at: string;
}

export interface CafeFacts {
  siteUrl: string;
  hours: HoursRow[];
  address?: { line1: string; line2?: string | null; city: string; state: string; postalCode: string } | null;
  phone?: string | null;
  email?: string | null;
  sameAs?: string[];
}

/** "07:00:00" → "07:00"; "24:00:00" → "23:59" (schema.org has no 24:00). */
function hhmm(time: string): string {
  const short = time.slice(0, 5);
  return short === "24:00" ? "23:59" : short;
}

/** Days with identical hours grouped into one specification each. */
export function openingHours(hours: HoursRow[]) {
  const byRange = new Map<string, Set<string>>();
  for (const row of [...hours].sort((a, b) => a.day_of_week - b.day_of_week || a.opens_at.localeCompare(b.opens_at))) {
    const key = `${hhmm(row.opens_at)}-${hhmm(row.closes_at)}`;
    const days = byRange.get(key) ?? new Set<string>();
    days.add(DAYS[row.day_of_week]);
    byRange.set(key, days);
  }
  return [...byRange.entries()].map(([range, days]) => {
    const [opens, closes] = range.split("-");
    return { "@type": "OpeningHoursSpecification", dayOfWeek: [...days], opens, closes };
  });
}

export function cafeStructuredData({ siteUrl, hours, address, phone, email, sameAs = [] }: CafeFacts) {
  const site = siteUrl.replace(/\/$/, "");
  const where = address ?? {
    line1: CAFE_ADDRESS.line1,
    line2: CAFE_ADDRESS.line2,
    city: CAFE_ADDRESS.city,
    state: CAFE_ADDRESS.state,
    postalCode: CAFE_ADDRESS.postalCode,
  };
  return {
    "@context": "https://schema.org",
    "@type": "CafeOrCoffeeShop",
    "@id": `${site}/#cafe`,
    name: BRAND.name,
    slogan: BRAND.taglines.primary,
    description: BRAND.taglines.secondary,
    url: `${site}/`,
    image: `${site}/opengraph-image.png`,
    logo: `${site}/icons/icon-512.png`,
    hasMenu: `${site}/menu`,
    servesCuisine: ["Coffee", "Tea", "Shave ice", "Smoothies", "Pastries"],
    priceRange: "$",
    currenciesAccepted: "USD",
    paymentAccepted: "Credit card, Apple Pay, Google Pay",
    address: {
      "@type": "PostalAddress",
      streetAddress: [where.line1, where.line2].filter(Boolean).join(", "),
      addressLocality: where.city,
      addressRegion: where.state,
      postalCode: where.postalCode,
      addressCountry: "US",
    },
    ...(phone ? { telephone: phone } : {}),
    ...(email ? { email } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(hours.length ? { openingHoursSpecification: openingHours(hours) } : {}),
    potentialAction: {
      "@type": "OrderAction",
      target: { "@type": "EntryPoint", urlTemplate: `${site}/menu`, actionPlatform: ["https://schema.org/DesktopWebPlatform", "https://schema.org/MobileWebPlatform"] },
      deliveryMethod: "http://purl.org/goodrelations/v1#DeliveryModePickUp",
    },
  };
}

/** JSON for a <script type="application/ld+json">: `<` escaped so no text can close the tag. */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

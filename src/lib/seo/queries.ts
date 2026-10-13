import "server-only";

/**
 * What search engines are told about the cafe and which pages to crawl.
 * Public data only, read with the anon key (RLS applies), fresh per request.
 */
import { connection } from "next/server";

import { clientEnv } from "@/lib/env";
import { getSiteContent } from "@/lib/content/queries";
import { logError } from "@/lib/log";
import { createPublicClient } from "@/lib/supabase/public";

import { cafeStructuredData, type HoursRow } from "./structured-data";

/** The main cafe's structured data (address and weekly hours from the database). */
export async function getCafeStructuredData() {
  await connection();
  const db = createPublicClient({ live: true });
  const [cafeResult, content] = await Promise.all([
    db
      .from("locations")
      .select("id, address_line1, address_line2, city, state, postal_code, location_hours(day_of_week, opens_at, closes_at)")
      .eq("type", "cafe")
      .eq("is_active", true)
      .order("sort_order")
      .limit(1)
      .maybeSingle(),
    getSiteContent(),
  ]);
  if (cafeResult.error) logError("seo.cafe_load_failed", cafeResult.error);
  const cafe = cafeResult.data;
  return cafeStructuredData({
    siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
    hours: (cafe?.location_hours ?? []) as HoursRow[],
    address:
      cafe?.address_line1 && cafe.city && cafe.postal_code
        ? { line1: cafe.address_line1, line2: cafe.address_line2, city: cafe.city, state: cafe.state, postalCode: cafe.postal_code }
        : null,
    phone: content.contact_phone || null,
    email: content.contact_email || null,
    sameAs: [content.instagram_url, content.facebook_url].filter(Boolean),
  });
}

export interface SitemapEntry {
  path: string;
  lastModified?: string;
}

/** Products on the menu, published upcoming or live pop-ups, live collections. */
export async function listSitemapEntries(): Promise<SitemapEntry[]> {
  await connection();
  const db = createPublicClient({ live: true });
  const now = new Date().toISOString();
  const [products, events, collections] = await Promise.all([
    db.from("products").select("slug, updated_at").eq("is_active", true).is("archived_at", null),
    db.from("locations").select("slug, updated_at").eq("type", "event").eq("is_published", true).gte("ends_at", now),
    db.from("collections").select("slug, updated_at").eq("is_active", true).lte("starts_at", now).gte("ends_at", now),
  ]);
  for (const result of [products, events, collections]) if (result.error) logError("seo.sitemap_load_failed", result.error);
  return [
    ...(products.data ?? []).map((p) => ({ path: `/menu/${p.slug}`, lastModified: p.updated_at })),
    ...(events.data ?? []).map((e) => ({ path: `/events/${e.slug}`, lastModified: e.updated_at })),
    ...(collections.data ?? []).map((c) => ({ path: `/collections/${c.slug}`, lastModified: c.updated_at })),
  ];
}

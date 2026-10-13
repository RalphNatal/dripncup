import type { MetadataRoute } from "next";

import { clientEnv } from "@/lib/env";
import { listSitemapEntries } from "@/lib/seo/queries";

/** Public pages that always exist. */
const STATIC_PATHS = ["/", "/menu", "/rewards", "/events", "/catering", "/about", "/accessibility", "/privacy", "/terms"];

/**
 * /sitemap.xml: the public pages, every product on the menu, published
 * pop-ups that haven't ended and collections running now. Read per request
 * (the menu changes in the admin), never at build time. Nothing private: the
 * same paths robots.txt disallows can't appear here.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const dynamic = await listSitemapEntries().catch(() => []);
  return [
    ...STATIC_PATHS.map((path) => ({ url: `${site}${path}`, changeFrequency: "weekly" as const, priority: path === "/" ? 1 : 0.7 })),
    ...dynamic.map((entry) => ({ url: `${site}${entry.path}`, lastModified: entry.lastModified, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}

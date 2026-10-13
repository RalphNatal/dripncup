import type { MetadataRoute } from "next";

import { clientEnv } from "@/lib/env";
import { DISALLOWED_PATHS } from "@/lib/seo/robots";

/** /robots.txt: crawl the public pages; the private ones are listed in src/lib/seo/robots.ts. */
export default function robots(): MetadataRoute.Robots {
  const site = clientEnv.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...DISALLOWED_PATHS] }],
    sitemap: `${site}/sitemap.xml`,
  };
}

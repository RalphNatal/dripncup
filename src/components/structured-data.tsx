import { headers } from "next/headers";

import { NONCE_HEADER } from "@/lib/request-headers";
import { getCafeStructuredData } from "@/lib/seo/queries";
import { jsonLd } from "@/lib/seo/structured-data";

/**
 * The cafe's schema.org data (CafeOrCoffeeShop: address, hours, contact,
 * links) as JSON-LD. A data block the browser never runs; it carries the
 * request's nonce anyway, so the Content Security Policy has nothing to say.
 */
export async function CafeStructuredData() {
  const [data, nonce] = await Promise.all([getCafeStructuredData(), headers().then((h) => h.get(NONCE_HEADER) ?? undefined)]);
  return <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: jsonLd(data) }} />;
}

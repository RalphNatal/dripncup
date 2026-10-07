import "server-only";

/**
 * Site content for the customer pages (About, privacy, terms, contact, the
 * logo) and the catering refund policy. Public rows, read fresh so an edit
 * shows at once; deduped within a request.
 */
import { cache } from "react";

import { clientEnv } from "@/lib/env";
import { publicStorageUrl } from "@/lib/menu/images";
import { createPublicClient } from "@/lib/supabase/public";

import type { ContentKey } from "./registry";

export const BRAND_ASSET_BUCKET = "brand-assets";

export type SiteContent = Record<ContentKey, string>;

const EMPTY: SiteContent = {
  about: "", contact_phone: "", contact_email: "", instagram_url: "", facebook_url: "", logo_path: "",
  privacy_policy: "", terms: "", refund_policy: "",
};

export const getSiteContent = cache(async (): Promise<SiteContent> => {
  const { data, error } = await createPublicClient({ live: true }).from("site_content").select("key, value");
  if (error) {
    console.error("Could not load site content", error);
    return { ...EMPTY };
  }
  const content = { ...EMPTY };
  for (const row of data ?? []) if (row.key in content) content[row.key as ContentKey] = row.value;
  return content;
});

/** The uploaded logo's public URL, or null for the typeset wordmark. */
export async function getLogoUrl(): Promise<string | null> {
  const { logo_path } = await getSiteContent();
  return logo_path ? publicStorageUrl(clientEnv.NEXT_PUBLIC_SUPABASE_URL, BRAND_ASSET_BUCKET, logo_path) : null;
}

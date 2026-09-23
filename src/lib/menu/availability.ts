import "server-only";

/**
 * What a location has run out of, read fresh on every request -- a barista
 * marking oat milk sold out must show up on the very next page load, so this
 * is never cached.
 */
import { createPublicClient } from "@/lib/supabase/public";

import { soldOutFromOverrides, type SoldOut } from "./model";

export async function getSoldOut(locationId: string, now: Date = new Date()): Promise<SoldOut> {
  const { data, error } = await createPublicClient({ live: true })
    .from("location_availability")
    .select("product_id, modifier_option_id, is_available, available_from")
    .eq("location_id", locationId);

  if (error) throw new Error(`Menu: could not load availability (${error.message})`);
  return soldOutFromOverrides(data ?? [], now);
}

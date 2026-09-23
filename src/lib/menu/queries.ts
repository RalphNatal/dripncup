import "server-only";

/**
 * What the menu and product pages load: the cached catalogue, combined with
 * the fresh storefront (selected location, status) and that location's
 * sold-out list.
 */
import { clientEnv } from "@/lib/env";
import { getStorefront, type LocationView } from "@/lib/locations/storefront";

import { getSoldOut } from "./availability";
import { getCatalog } from "./catalog";
import { buildMenu, buildProductDetail, type MenuView, type ProductDetail } from "./model";

export interface OrderingState {
  canOrder: boolean;
  /** Why ordering is off right now, as a sentence. */
  reason: string | null;
}

function orderingFor(location: LocationView): OrderingState {
  return { canOrder: location.status.canOrder, reason: location.status.unavailableReason };
}

export async function getMenuPageData(): Promise<{ location: LocationView; menu: MenuView } | null> {
  const { selected } = await getStorefront();
  if (!selected) return null;

  const now = new Date();
  const [catalog, soldOut] = await Promise.all([getCatalog(), getSoldOut(selected.id, now)]);

  return {
    location: selected,
    menu: buildMenu(catalog, {
      location: { id: selected.id, type: selected.type },
      soldOut,
      now,
      supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    }),
  };
}

export interface ProductPageData {
  detail: ProductDetail;
  location: { id: string; name: string };
  ordering: OrderingState;
}

export async function getProductPageData(slug: string): Promise<ProductPageData | null> {
  const { selected } = await getStorefront();
  if (!selected) return null;

  const now = new Date();
  const [catalog, soldOut] = await Promise.all([getCatalog(), getSoldOut(selected.id, now)]);
  const detail = buildProductDetail(catalog, slug, {
    location: { id: selected.id, type: selected.type },
    soldOut,
    now,
    supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (!detail) return null;

  return { detail, location: { id: selected.id, name: selected.name }, ordering: orderingFor(selected) };
}

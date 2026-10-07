import "server-only";

/**
 * The current menu at the selected location, ready for re-checking saved
 * drinks (reorder and favourites). Read live by default, like checkout, so a
 * price shown in a review is what the cart will charge. `live: false` uses
 * the 60-second menu cache, for lists that only display (the favourites row);
 * sold-out flags are always live.
 */
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";
import { getStorefront, type LocationView } from "@/lib/locations/storefront";
import { getSoldOut } from "@/lib/menu/availability";
import { getCatalog, getLiveCatalog } from "@/lib/menu/catalog";
import { buildProductDetail, type ProductDetail } from "@/lib/menu/model";

import { reviewSavedLine, type LineReview, type SavedLine } from "./reorder";

export interface ReviewContext {
  location: LocationView;
  /** Locations a customer may switch to right now. */
  offered: LocationView[];
  review: (saved: SavedLine) => LineReview;
  /** The product as the menu builds it at this location; null if it is gone. */
  detailFor: (productId: string | null) => ProductDetail | null;
}

export async function loadReviewContext({ live = true }: { live?: boolean } = {}): Promise<ReviewContext | null> {
  const { selected, locations } = await getStorefront();
  if (!selected) return null;

  const now = await appNow();
  const [catalog, soldOut] = await Promise.all([live ? getLiveCatalog() : getCatalog(), getSoldOut(selected.id, now)]);
  const ctx = {
    location: { id: selected.id, type: selected.type },
    soldOut,
    now,
    supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
  };
  const details = new Map<string, ProductDetail | null>();
  const detailFor = (productId: string | null) => {
    if (!productId) return null;
    if (!details.has(productId)) {
      const slug = catalog.products.find((p) => p.id === productId)?.slug;
      details.set(productId, slug ? buildProductDetail(catalog, slug, ctx) : null);
    }
    return details.get(productId) ?? null;
  };

  return {
    location: selected,
    offered: locations,
    detailFor,
    review: (saved) => reviewSavedLine(saved, detailFor(saved.productId), { id: selected.id, name: selected.name }),
  };
}

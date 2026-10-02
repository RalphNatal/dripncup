import "server-only";

/**
 * The signed-in customer's favourites, each checked against the current menu
 * at the selected location (the same check "Order again" uses), so a list can
 * say which ones can be added and why the others cannot. Read with the
 * customer's session: RLS limits it to their own rows.
 */
import type { LocationView } from "@/lib/locations/storefront";
import { describeSnapshotModifier, type SnapshotModifier } from "@/lib/orders/detail";
import type { LineReview, SavedLine } from "@/lib/orders/reorder";
import { loadReviewContext } from "@/lib/orders/review-context";
import { createClient } from "@/lib/supabase/server";

export interface FavoriteView {
  id: string;
  name: string;
  /** The product's current name, or the saved one if it has left the menu. */
  productName: string;
  /** "Large · Oat milk", as it was saved. */
  savedSummary: string[];
  review: LineReview;
}

export interface FavoritesList {
  favorites: FavoriteView[];
  location: Pick<LocationView, "id" | "name">;
  ordering: { canOrder: boolean; reason: string | null };
}

export const FAVORITE_SELECT =
  "id, name, product_id, product_size_id, size_name, modifiers, quantity, special_instructions, created_at, products(name)";

export interface FavoriteRow {
  id: string;
  name: string;
  product_id: string;
  product_size_id: string | null;
  size_name: string | null;
  modifiers: unknown;
  quantity: number;
  special_instructions: string | null;
  created_at: string;
  products: { name: string } | null;
}

export function savedLineOf(row: FavoriteRow): SavedLine {
  const modifiers = Array.isArray(row.modifiers) ? (row.modifiers as SnapshotModifier[]) : [];
  return {
    key: row.id,
    productId: row.product_id,
    productName: row.products?.name ?? row.name,
    sizeId: row.product_size_id,
    sizeName: row.size_name,
    modifiers,
    quantity: row.quantity,
    specialInstructions: row.special_instructions,
    // A favourite has no price to compare against.
    previousUnitPriceCents: null,
  };
}

/** Newest first. `live: false` reads the cached menu (display only; adding re-checks live). */
export async function listFavorites({ live = false }: { live?: boolean } = {}): Promise<FavoritesList | null> {
  const supabase = await createClient();
  const [{ data, error }, context] = await Promise.all([
    supabase.from("favorites").select(FAVORITE_SELECT).order("created_at", { ascending: false }).limit(50),
    loadReviewContext({ live }),
  ]);
  if (error) throw new Error(`Could not load favorites: ${error.message}`);
  if (!context) return null;

  const favorites = ((data ?? []) as unknown as FavoriteRow[]).map((row) => {
    const saved = savedLineOf(row);
    return {
      id: row.id,
      name: row.name,
      productName: saved.productName,
      savedSummary: [...(row.size_name ? [row.size_name] : []), ...saved.modifiers.map(describeSnapshotModifier)],
      review: context.review(saved),
    };
  });

  return {
    favorites,
    location: { id: context.location.id, name: context.location.name },
    ordering: { canOrder: context.location.status.canOrder, reason: context.location.status.unavailableReason },
  };
}

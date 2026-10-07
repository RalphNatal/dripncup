import "server-only";

/**
 * The menu catalogue: categories, products, sizes, modifier groups and their
 * links, seasonal collections and event menus.
 *
 * Cached across requests (it changes when the owner edits the menu, not per
 * customer) and tagged so the admin menu editor can refresh it immediately
 * with `revalidateTag(MENU_CACHE_TAG, "max")`. What is NOT in here is anything
 * that must be fresh on every request: sold-out flags, the pause toggle and
 * opening hours are read live (see ./availability.ts and
 * @/lib/locations/storefront.ts).
 */
import { unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";
import type { Tables } from "@/types/database";

export const MENU_CACHE_TAG = "menu";

/** Seconds before a cached catalogue is refreshed even without an edit. */
const CATALOG_REVALIDATE_SECONDS = 60;

export interface CatalogData {
  categories: Pick<Tables<"categories">, "id" | "name" | "slug" | "description" | "sort_order">[];
  products: Pick<
    Tables<"products">,
    | "id"
    | "category_id"
    | "name"
    | "slug"
    | "description"
    | "image_url"
    | "base_price_cents"
    | "allergens"
    | "dietary_tags"
    | "calories"
    | "sort_order"
    | "available_from"
    | "available_until"
  >[];
  sizes: Pick<Tables<"product_sizes">, "id" | "product_id" | "name" | "price_cents" | "volume_oz" | "is_default" | "sort_order">[];
  groups: Pick<
    Tables<"modifier_groups">,
    | "id"
    | "name"
    | "description"
    | "selection_type"
    | "is_required"
    | "min_selections"
    | "max_selections"
    | "max_quantity_per_option"
    | "quantity_unit"
    | "charge_per_quantity"
  >[];
  options: Pick<
    Tables<"modifier_options">,
    "id" | "modifier_group_id" | "name" | "price_delta_cents" | "is_default" | "max_quantity" | "allergens" | "sort_order"
  >[];
  links: Tables<"product_modifier_groups">[];
  collections: Pick<
    Tables<"collections">,
    "id" | "name" | "slug" | "description" | "banner_image_url" | "accent_color" | "starts_at" | "ends_at" | "sort_order"
  >[];
  collectionProducts: Pick<Tables<"collection_products">, "collection_id" | "product_id" | "sort_order">[];
  eventMenuItems: Pick<Tables<"event_menu_items">, "location_id" | "product_id" | "sort_order">[];
}

function rows<T>(result: { data: T[] | null; error: { message: string } | null }, label: string): T[] {
  if (result.error) throw new Error(`Menu: could not load ${label} (${result.error.message})`);
  return result.data ?? [];
}

async function fetchCatalog({ live = false }: { live?: boolean } = {}): Promise<CatalogData> {
  const db = createPublicClient({ live });

  // RLS already limits a guest to active rows; ordering happens here once.
  const [categories, products, sizes, groups, options, links, collections, collectionProducts, eventMenuItems] =
    await Promise.all([
      db.from("categories").select("id, name, slug, description, sort_order").order("sort_order").order("name"),
      db
        .from("products")
        .select(
          "id, category_id, name, slug, description, image_url, base_price_cents, allergens, dietary_tags, calories, sort_order, available_from, available_until",
        )
        .order("sort_order")
        .order("name"),
      db
        .from("product_sizes")
        .select("id, product_id, name, price_cents, volume_oz, is_default, sort_order")
        .order("sort_order"),
      db
        .from("modifier_groups")
        .select(
          "id, name, description, selection_type, is_required, min_selections, max_selections, max_quantity_per_option, quantity_unit, charge_per_quantity",
        ),
      db
        .from("modifier_options")
        .select("id, modifier_group_id, name, price_delta_cents, is_default, max_quantity, allergens, sort_order")
        .order("sort_order")
        .order("name"),
      db.from("product_modifier_groups").select("*").order("sort_order"),
      db
        .from("collections")
        .select("id, name, slug, description, banner_image_url, accent_color, starts_at, ends_at, sort_order")
        .order("sort_order"),
      db.from("collection_products").select("collection_id, product_id, sort_order").order("sort_order"),
      db.from("event_menu_items").select("location_id, product_id, sort_order").order("sort_order"),
    ]);

  return {
    categories: rows(categories, "categories"),
    products: rows(products, "products"),
    sizes: rows(sizes, "sizes"),
    groups: rows(groups, "modifier groups"),
    options: rows(options, "modifier options"),
    links: rows(links, "product modifiers"),
    collections: rows(collections, "collections"),
    collectionProducts: rows(collectionProducts, "collection products"),
    eventMenuItems: rows(eventMenuItems, "event menus"),
  };
}

/** For browsing: may be up to a minute old. */
export const getCatalog = unstable_cache(() => fetchCatalog(), ["menu-catalog", "v2"], {
  tags: [MENU_CACHE_TAG],
  revalidate: CATALOG_REVALIDATE_SECONDS,
});

/**
 * For the cart and checkout: never cached. A price or modifier changed a
 * second ago must be what the customer is charged and told about.
 */
export function getLiveCatalog(): Promise<CatalogData> {
  return fetchCatalog({ live: true });
}

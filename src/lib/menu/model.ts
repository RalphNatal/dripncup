/**
 * Catalogue rows -> what the menu page and product sheet render, and the
 * shapes the pricing engine validates.
 *
 * Pure (no I/O, `now` passed in), so it can be unit-tested and so checkout
 * can build exactly the same PricingProduct / PricingModifierGroup values on
 * the server. This is where per-product overrides, sold-out flags and event
 * menus are applied, and limited-time products outside their window are
 * dropped -- nothing downstream needs to know about them.
 */
import {
  startingPriceCents,
  type PricingModifierGroup,
  type PricingModifierOption,
  type PricingProduct,
  type PricingSize,
} from "@/lib/pricing";
import type { Enums } from "@/types/database";

import { isProductAvailableAt } from "./availability-window";
import type { CatalogData } from "./catalog";
import { productImageUrl, safeCssColor, storageImageUrl } from "./images";

export type Allergen = Enums<"allergen">;
export type DietaryTag = Enums<"dietary_tag">;

/** Ids sold out at one location. Arrays, so it serialises to client components. */
export interface SoldOut {
  productIds: string[];
  optionIds: string[];
}

export interface MenuContext {
  location: { id: string; type: "cafe" | "event" };
  soldOut: SoldOut;
  now: Date;
  /** For turning Storage paths into image URLs. */
  supabaseUrl: string;
}

export interface MenuProductCard {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** The cheapest size, or the single price. */
  fromPriceCents: number;
  /** True when sizes differ in price, so the card reads "From $X.XX". */
  priceVaries: boolean;
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
  soldOut: boolean;
}

export interface MenuSection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  products: MenuProductCard[];
}

export interface MenuCollection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  accentColor: string | null;
  bannerImageUrl: string | null;
  products: Pick<MenuProductCard, "slug" | "name">[];
}

export interface MenuView {
  sections: MenuSection[];
  collection: MenuCollection | null;
  /** False for a pop-up whose limited menu has not been set up yet. */
  menuPublished: boolean;
}

export interface DetailSize extends PricingSize {
  volumeOz: number | null;
}

export interface DetailOption extends PricingModifierOption {
  allergens: Allergen[];
}

export interface DetailGroup extends Omit<PricingModifierGroup, "options"> {
  description: string | null;
  options: DetailOption[];
}

export interface ProductDetail {
  /** Still a PricingProduct: DetailSize only adds display fields. */
  product: Omit<PricingProduct, "sizes"> & {
    sizes: DetailSize[];
    slug: string;
    description: string | null;
    imageUrl: string | null;
    allergens: Allergen[];
    dietaryTags: DietaryTag[];
    calories: number | null;
    /** For reward eligibility ("any drink"). */
    categoryId: string | null;
    categoryName: string | null;
  };
  groups: DetailGroup[];
  /** False when the product exists but this location (a pop-up) does not carry it. */
  onLocationMenu: boolean;
}

/** Name of the section holding products that have no category. */
export const UNCATEGORISED_SECTION = { id: "uncategorised", slug: "more", name: "More to try" } as const;

/**
 * `location_availability` rows -> what is sold out right now. A row with
 * `available_from` in the past has lifted itself ("out of oat milk until
 * tomorrow"), and `is_available = true` rows are explicit "back in stock".
 */
export function soldOutFromOverrides(
  rows: readonly {
    product_id: string | null;
    modifier_option_id: string | null;
    is_available: boolean;
    available_from: string | null;
  }[],
  now: Date,
): SoldOut {
  const soldOut: SoldOut = { productIds: [], optionIds: [] };
  for (const row of rows) {
    if (row.is_available) continue;
    if (row.available_from && new Date(row.available_from) <= now) continue;
    if (row.product_id) soldOut.productIds.push(row.product_id);
    if (row.modifier_option_id) soldOut.optionIds.push(row.modifier_option_id);
  }
  return soldOut;
}

/** Everything at a cafe; only the published list at a pop-up (empty = not published yet). */
function offeredProductIds(catalog: CatalogData, location: MenuContext["location"]): Set<string> | null {
  if (location.type !== "event") return null;
  return new Set(catalog.eventMenuItems.filter((i) => i.location_id === location.id).map((i) => i.product_id));
}

/** Display order comes from the data, never from how a query happened to return rows. */
const bySortOrder = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

function sizesFor(catalog: CatalogData, productId: string): DetailSize[] {
  return catalog.sizes
    .filter((s) => s.product_id === productId)
    .sort(bySortOrder)
    .map((s) => ({
      id: s.id,
      name: s.name,
      priceCents: s.price_cents,
      isDefault: s.is_default,
      volumeOz: s.volume_oz,
    }));
}

/**
 * A product in an inactive category is hidden; one with no category goes
 * under "More to try". A limited-time product is listed only inside its
 * availability window.
 */
function isListed(catalog: CatalogData, product: CatalogData["products"][number], now: Date): boolean {
  return (
    isProductAvailableAt(product, now) &&
    (product.category_id === null || catalog.categories.some((c) => c.id === product.category_id))
  );
}

export function buildMenu(catalog: CatalogData, ctx: MenuContext): MenuView {
  const offered = offeredProductIds(catalog, ctx.location);
  const soldOut = new Set(ctx.soldOut.productIds);

  const cards = new Map<string, MenuProductCard>();
  const categoryOf = new Map<string, string | null>();
  for (const product of catalog.products) {
    if (!isListed(catalog, product, ctx.now)) continue;
    if (offered && !offered.has(product.id)) continue;
    categoryOf.set(product.id, product.category_id);
    const sizes = sizesFor(catalog, product.id);
    cards.set(product.id, {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      imageUrl: productImageUrl(product.image_url, ctx.supabaseUrl),
      fromPriceCents: startingPriceCents({ basePriceCents: product.base_price_cents, sizes }),
      priceVaries: new Set(sizes.map((s) => s.priceCents)).size > 1,
      allergens: product.allergens,
      dietaryTags: product.dietary_tags,
      soldOut: soldOut.has(product.id),
    });
  }

  const inCategory = (categoryId: string | null) =>
    [...cards.values()].filter((card) => categoryOf.get(card.id) === categoryId);

  const sections: MenuSection[] = catalog.categories
    .map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      description: category.description,
      products: inCategory(category.id),
    }))
    .filter((section) => section.products.length > 0);

  const uncategorised = inCategory(null);
  if (uncategorised.length > 0) {
    sections.push({ ...UNCATEGORISED_SECTION, description: null, products: uncategorised });
  }

  return {
    sections,
    collection: activeCollection(catalog, ctx, cards),
    menuPublished: offered === null || offered.size > 0,
  };
}

/**
 * The current seasonal collection: one whose window is open and that has
 * something on this menu. When seasons overlap, the lowest sort order wins,
 * then the one that started most recently (the new season takes the banner).
 */
function activeCollection(
  catalog: CatalogData,
  ctx: MenuContext,
  cards: Map<string, MenuProductCard>,
): MenuCollection | null {
  const open = catalog.collections
    .filter((c) => new Date(c.starts_at) <= ctx.now && ctx.now < new Date(c.ends_at))
    .sort((a, b) => a.sort_order - b.sort_order || Date.parse(b.starts_at) - Date.parse(a.starts_at));

  for (const collection of open) {
    const products = catalog.collectionProducts
      .filter((cp) => cp.collection_id === collection.id)
      .flatMap((cp) => {
        const card = cards.get(cp.product_id);
        return card ? [{ slug: card.slug, name: card.name }] : [];
      });
    if (products.length > 0) return toMenuCollection(collection, products, ctx);
  }
  return null;
}

function toMenuCollection(
  collection: CatalogData["collections"][number],
  products: MenuCollection["products"],
  ctx: MenuContext,
): MenuCollection {
  return {
    id: collection.id,
    slug: collection.slug,
    name: collection.name,
    description: collection.description,
    accentColor: safeCssColor(collection.accent_color),
    bannerImageUrl: storageImageUrl(collection.banner_image_url, ctx.supabaseUrl, "collection-banners"),
    products,
  };
}

/**
 * Applies a product's link overrides to a shared group. Required implies at
 * least one choice, and single-select means at most one, whatever the data
 * says -- the engine can then trust these numbers.
 */
function toDetailGroup(
  group: CatalogData["groups"][number],
  link: CatalogData["links"][number],
  options: CatalogData["options"],
  soldOutOptions: Set<string>,
): DetailGroup {
  const single = group.selection_type === "single";
  const required = link.override_is_required ?? group.is_required;
  const minSelections = required
    ? Math.max(1, link.override_min_selections ?? group.min_selections)
    : (link.override_min_selections ?? group.min_selections);
  const rawMax = single ? 1 : (link.override_max_selections ?? group.max_selections);
  const maxSelections = rawMax === null ? null : Math.max(rawMax, minSelections);

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    selectionType: group.selection_type,
    required,
    minSelections,
    maxSelections,
    chargePerQuantity: group.charge_per_quantity,
    quantityUnit: group.quantity_unit,
    visibleWhenOptionId: link.visible_when_option_id,
    options: options.map((option) => ({
      id: option.id,
      name: option.name,
      priceDeltaCents: option.price_delta_cents,
      isDefault: option.is_default,
      maxQuantity: single ? 1 : Math.max(1, Math.min(option.max_quantity, group.max_quantity_per_option)),
      soldOut: soldOutOptions.has(option.id),
      allergens: option.allergens,
    })),
  };
}

export function buildProductDetail(catalog: CatalogData, slug: string, ctx: MenuContext): ProductDetail | null {
  const product = catalog.products.find((p) => p.slug === slug);
  if (!product || !isListed(catalog, product, ctx.now)) return null;

  const offered = offeredProductIds(catalog, ctx.location);
  const soldOutOptions = new Set(ctx.soldOut.optionIds);
  const groupsById = new Map(catalog.groups.map((g) => [g.id, g]));

  const groups = catalog.links
    .filter((link) => link.product_id === product.id)
    .sort(bySortOrder)
    .flatMap((link) => {
      const group = groupsById.get(link.modifier_group_id);
      const options = catalog.options
        .filter((o) => o.modifier_group_id === link.modifier_group_id)
        .sort(bySortOrder);
      // An inactive group, or one with no active options, has nothing to show.
      return group && options.length > 0 ? [toDetailGroup(group, link, options, soldOutOptions)] : [];
    });

  return {
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      imageUrl: productImageUrl(product.image_url, ctx.supabaseUrl),
      basePriceCents: product.base_price_cents,
      soldOut: ctx.soldOut.productIds.includes(product.id),
      sizes: sizesFor(catalog, product.id),
      allergens: product.allergens,
      dietaryTags: product.dietary_tags,
      calories: product.calories,
      categoryId: product.category_id,
      categoryName: catalog.categories.find((c) => c.id === product.category_id)?.name ?? null,
    },
    groups,
    onLocationMenu: offered === null || offered.has(product.id),
  };
}

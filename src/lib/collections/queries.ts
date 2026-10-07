import "server-only";

/**
 * Seasonal collections: the customer page (/collections/[slug]) and the
 * admin list and form. The menu and Home banners use the cached catalogue
 * (src/lib/menu/model.ts, activeCollection); this reads live.
 */
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";
import { getStorefront } from "@/lib/locations/storefront";
import { getSoldOut } from "@/lib/menu/availability";
import { getCatalog } from "@/lib/menu/catalog";
import { safeCssColor, storageImageUrl } from "@/lib/menu/images";
import { buildMenu, type MenuProductCard } from "@/lib/menu/model";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

import { profileNames } from "@/lib/events/queries";

export const COLLECTION_BANNER_BUCKET = "collection-banners";

export type CollectionPhase = "upcoming" | "active" | "ended";

export interface CollectionPage {
  slug: string;
  name: string;
  description: string | null;
  bannerImageUrl: string | null;
  accentColor: string | null;
  startsAt: string;
  endsAt: string;
  phase: CollectionPhase;
  /** On the menu at the selected location right now, in the collection's order. */
  products: MenuProductCard[];
}

export function collectionPhase(c: { starts_at: string; ends_at: string }, now: Date): CollectionPhase {
  if (now.getTime() < Date.parse(c.starts_at)) return "upcoming";
  if (now.getTime() >= Date.parse(c.ends_at)) return "ended";
  return "active";
}

/**
 * The collection page. Null for an unknown, switched-off or not-yet-started
 * collection (nothing to show, and nothing to give away early); an ended one
 * comes back with phase "ended" so the page can say so.
 */
export async function getCollectionPage(slug: string): Promise<CollectionPage | null> {
  const now = await appNow();
  const { data } = await createPublicClient({ live: true })
    .from("collections")
    .select("id, slug, name, description, banner_image_url, accent_color, starts_at, ends_at, is_active, products:collection_products(product_id, sort_order)")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const phase = collectionPhase(data, now);
  if (phase === "upcoming") return null;

  let products: MenuProductCard[] = [];
  if (phase === "active") {
    const { selected } = await getStorefront();
    if (selected) {
      const [catalog, soldOut] = await Promise.all([getCatalog(), getSoldOut(selected.id, now)]);
      const menu = buildMenu(catalog, {
        location: { id: selected.id, type: selected.type },
        soldOut,
        now,
        supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      });
      const cards = new Map(menu.sections.flatMap((s) => s.products).map((p) => [p.id, p]));
      products = [...data.products]
        .sort((a, b) => a.sort_order - b.sort_order)
        .flatMap((cp) => (cards.has(cp.product_id) ? [cards.get(cp.product_id)!] : []));
    }
  }

  return {
    slug: data.slug,
    name: data.name,
    description: data.description,
    bannerImageUrl: storageImageUrl(data.banner_image_url, clientEnv.NEXT_PUBLIC_SUPABASE_URL, COLLECTION_BANNER_BUCKET),
    accentColor: safeCssColor(data.accent_color),
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    phase,
    products,
  };
}

// ---------------------------------------------------------------------------
// Admin.
// ---------------------------------------------------------------------------

export interface AdminCollectionRow {
  id: string;
  name: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  phase: CollectionPhase;
  accentColor: string | null;
  productCount: number;
}

export async function listAdminCollections(): Promise<AdminCollectionRow[]> {
  const now = await appNow();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collections")
    .select("id, name, slug, starts_at, ends_at, is_active, accent_color, products:collection_products(count)")
    .order("starts_at", { ascending: false });
  if (error) throw new Error(`Collections: could not load (${error.message})`);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    isActive: c.is_active,
    phase: collectionPhase(c, now),
    accentColor: c.accent_color,
    productCount: (c.products as unknown as { count: number }[])[0]?.count ?? 0,
  }));
}

export interface AdminCollectionDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  bannerPath: string | null;
  accentColor: string | null;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  /** In display order; `limited` = the product sells only during this collection. */
  products: { productId: string; limited: boolean }[];
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
}

export async function getAdminCollection(id: string): Promise<AdminCollectionDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("collections")
    .select(
      "id, name, slug, description, banner_image_url, accent_color, starts_at, ends_at, is_active, created_at, updated_at, created_by, updated_by, products:collection_products(product_id, sort_order, product:products(available_from, available_until))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Collections: could not load (${error.message})`);
  if (!data) return null;
  const names = await profileNames([data.created_by, data.updated_by]);
  const same = (a: string | null | undefined, b: string) => Boolean(a) && Date.parse(a!) === Date.parse(b);
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    bannerPath: data.banner_image_url,
    accentColor: data.accent_color,
    startsAt: data.starts_at,
    endsAt: data.ends_at,
    isActive: data.is_active,
    products: [...data.products]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((cp) => ({
        productId: cp.product_id,
        limited: same(cp.product?.available_from, data.starts_at) && same(cp.product?.available_until, data.ends_at),
      })),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdByName: data.created_by ? (names.get(data.created_by) ?? null) : null,
    updatedByName: data.updated_by ? (names.get(data.updated_by) ?? null) : null,
  };
}

/** A preview URL for a banner path (the admin form shows the stored banner). */
export function bannerUrl(path: string | null): string | null {
  return storageImageUrl(path, clientEnv.NEXT_PUBLIC_SUPABASE_URL, COLLECTION_BANNER_BUCKET);
}


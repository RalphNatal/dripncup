import "server-only";

/**
 * Pop-up events, for customers (published only: RLS hides the rest from
 * guests and customers) and for the admin (everything).
 */
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";
import { storageImageUrl } from "@/lib/menu/images";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

import { eventPhase, type EventPhase } from "./window";

export const EVENT_IMAGE_BUCKET = "location-images";

export interface PublicEvent {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  phase: EventPhase;
  addressLines: string[];
  /** For a directions link: the admin's map link, else the address or coordinates. */
  mapUrl: string | null;
  directionsQuery: string;
  imageUrl: string | null;
  pickupInstructions: string | null;
  menu: { slug: string; name: string }[];
}

type EventRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  map_url: string | null;
  image_url: string | null;
  pickup_instructions: string | null;
  menu: { sort_order: number; product: { slug: string; name: string; is_active: boolean } | null }[];
};

const PUBLIC_SELECT =
  "id, slug, name, description, starts_at, ends_at, address_line1, address_line2, city, state, postal_code, latitude, longitude, map_url, image_url, pickup_instructions, menu:event_menu_items(sort_order, product:products(slug, name, is_active))";

function toPublic(row: EventRow, now: Date): PublicEvent {
  const cityLine = [row.city, [row.state, row.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const addressLines = [row.address_line1, row.address_line2, cityLine].filter((l): l is string => Boolean(l));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    startsAt: row.starts_at!,
    endsAt: row.ends_at!,
    phase: eventPhase({ startsAt: row.starts_at!, endsAt: row.ends_at! }, now),
    addressLines,
    mapUrl: row.map_url,
    directionsQuery:
      row.address_line1 !== null
        ? [row.address_line1, cityLine].join(", ")
        : row.latitude !== null && row.longitude !== null
          ? `${row.latitude},${row.longitude}`
          : row.name,
    imageUrl: storageImageUrl(row.image_url, clientEnv.NEXT_PUBLIC_SUPABASE_URL, EVENT_IMAGE_BUCKET),
    pickupInstructions: row.pickup_instructions,
    menu: [...row.menu]
      .sort((a, b) => a.sort_order - b.sort_order)
      .flatMap((m) => (m.product && m.product.is_active ? [{ slug: m.product.slug, name: m.product.name }] : [])),
  };
}

/** Live and upcoming published events, soonest first. Never past or unpublished ones. */
export async function listPublicEvents({ limit = 50 }: { limit?: number } = {}): Promise<PublicEvent[]> {
  const now = await appNow();
  const { data, error } = await createPublicClient({ live: true })
    .from("locations")
    .select(PUBLIC_SELECT)
    .eq("type", "event")
    .eq("is_active", true)
    .eq("is_published", true)
    .gt("ends_at", now.toISOString())
    .order("starts_at")
    .limit(limit);
  if (error) throw new Error(`Events: could not load (${error.message})`);
  return ((data ?? []) as unknown as EventRow[]).map((row) => toPublic(row, now));
}

/** One published event by slug (past ones too, so an old link explains itself). */
export async function getPublicEvent(slug: string): Promise<PublicEvent | null> {
  const now = await appNow();
  const { data, error } = await createPublicClient({ live: true })
    .from("locations")
    .select(PUBLIC_SELECT)
    .eq("type", "event")
    .eq("is_active", true)
    .eq("is_published", true)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Events: could not load (${error.message})`);
  return data ? toPublic(data as unknown as EventRow, now) : null;
}

// ---------------------------------------------------------------------------
// Admin.
// ---------------------------------------------------------------------------

export interface AdminEventRow {
  id: string;
  name: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  phase: EventPhase;
  isPublished: boolean;
  isActive: boolean;
  place: string;
  menuCount: number;
  staffCount: number;
}

export async function listAdminEvents(): Promise<{ now: string; events: AdminEventRow[] }> {
  const now = await appNow();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, name, slug, starts_at, ends_at, is_published, is_active, address_line1, city, menu:event_menu_items(count), staff:staff_locations(count)")
    .eq("type", "event")
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`Events: could not load (${error.message})`);
  return {
    now: now.toISOString(),
    events: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      startsAt: row.starts_at!,
      endsAt: row.ends_at!,
      phase: eventPhase({ startsAt: row.starts_at!, endsAt: row.ends_at! }, now),
      isPublished: row.is_published,
      isActive: row.is_active,
      place: [row.address_line1, row.city].filter(Boolean).join(", "),
      menuCount: (row.menu as unknown as { count: number }[])[0]?.count ?? 0,
      staffCount: (row.staff as unknown as { count: number }[])[0]?.count ?? 0,
    })),
  };
}

export interface AdminEventDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  mapUrl: string | null;
  startsAt: string;
  endsAt: string;
  prepTimeMinutes: number;
  imagePath: string | null;
  pickupInstructions: string | null;
  isPublished: boolean;
  menu: string[];
  staff: string[];
  createdAt: string;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
}

export async function getAdminEvent(id: string): Promise<AdminEventDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("locations")
    .select(
      "id, name, slug, description, address_line1, address_line2, city, postal_code, latitude, longitude, map_url, starts_at, ends_at, prep_time_minutes, image_url, pickup_instructions, is_published, created_at, updated_at, created_by, updated_by, menu:event_menu_items(product_id, sort_order), staff:staff_locations(profile_id)",
    )
    .eq("id", id)
    .eq("type", "event")
    .maybeSingle();
  if (error) throw new Error(`Events: could not load (${error.message})`);
  if (!data) return null;

  const names = await profileNames([data.created_by, data.updated_by]);
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description,
    addressLine1: data.address_line1,
    addressLine2: data.address_line2,
    city: data.city,
    postalCode: data.postal_code,
    latitude: data.latitude,
    longitude: data.longitude,
    mapUrl: data.map_url,
    startsAt: data.starts_at!,
    endsAt: data.ends_at!,
    prepTimeMinutes: data.prep_time_minutes,
    imagePath: data.image_url,
    pickupInstructions: data.pickup_instructions,
    isPublished: data.is_published,
    menu: [...data.menu].sort((a, b) => a.sort_order - b.sort_order).map((m) => m.product_id),
    staff: data.staff.map((s) => s.profile_id),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    createdByName: data.created_by ? (names.get(data.created_by) ?? null) : null,
    updatedByName: data.updated_by ? (names.get(data.updated_by) ?? null) : null,
  };
}

/** Admin-only (RLS): display names for audit columns. */
export async function profileNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, first_name, email").in("id", wanted);
  return new Map((data ?? []).map((p) => [p.id, p.full_name ?? p.first_name ?? p.email ?? "Someone"]));
}

export interface PickerProduct {
  id: string;
  slug: string;
  name: string;
  categoryName: string | null;
  isActive: boolean;
  isCateringEligible: boolean;
  basePriceCents: number;
  sizes: { id: string; name: string; priceCents: number }[];
  availableFrom: string | null;
  availableUntil: string | null;
}

/** Every product, for the admin's menu pickers (event menus, collections, quotes). */
export async function listPickerProducts(): Promise<PickerProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, slug, name, is_active, is_catering_eligible, base_price_cents, sort_order, available_from, available_until, category:categories(name, sort_order), sizes:product_sizes(id, name, price_cents, sort_order, is_active)",
    )
    .order("sort_order");
  if (error) throw new Error(`Products: could not load (${error.message})`);
  return (data ?? [])
    .sort((a, b) => (a.category?.sort_order ?? 999) - (b.category?.sort_order ?? 999) || a.sort_order - b.sort_order)
    .map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      categoryName: p.category?.name ?? null,
      isActive: p.is_active,
      isCateringEligible: p.is_catering_eligible,
      basePriceCents: p.base_price_cents,
      sizes: [...(p.sizes ?? [])]
        .filter((s) => s.is_active)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({ id: s.id, name: s.name, priceCents: s.price_cents })),
      availableFrom: p.available_from,
      availableUntil: p.available_until,
    }));
}

/** Staff accounts that can be rostered at an event. */
export async function listStaffProfiles(): Promise<{ id: string; name: string; email: string | null }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, first_name, email")
    .eq("role", "staff")
    .is("deleted_at", null)
    .order("full_name");
  if (error) throw new Error(`Staff: could not load (${error.message})`);
  return (data ?? []).map((p) => ({ id: p.id, name: p.full_name ?? p.first_name ?? p.email ?? "Staff", email: p.email }));
}

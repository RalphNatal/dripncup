import "server-only";

/**
 * The menu as the admin sees it: everything, switched off and archived
 * included (admins read all rows through RLS), in display order.
 */
import { createClient } from "@/lib/supabase/server";

import { centsToInput, type AdminGroup, type GroupDraft, type ProductDraft } from "./rules";

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
}

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  categoryId: string | null;
  isActive: boolean;
  archived: boolean;
  cateringEligible: boolean;
  limitedTime: boolean;
  price: string;
  imagePath: string | null;
}

export type Usage = Record<string, number>;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const supabase = await createClient();
  const [{ data: categories, error }, { data: products }] = await Promise.all([
    supabase.from("categories").select("id, name, slug, description, is_active").order("sort_order").order("name"),
    supabase.from("products").select("category_id"),
  ]);
  if (error) throw new Error(`Menu: ${error.message}`);
  return (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    isActive: c.is_active,
    productCount: (products ?? []).filter((p) => p.category_id === c.id).length,
  }));
}

export async function listAdminProducts(): Promise<AdminProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, name, slug, category_id, is_active, archived_at, is_catering_eligible, base_price_cents, image_url, available_from, available_until, product_sizes(price_cents, is_active)")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`Menu: ${error.message}`);
  return (data ?? []).map((p) => {
    const prices = (p.product_sizes ?? []).filter((s) => s.is_active).map((s) => s.price_cents).sort((a, b) => a - b);
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      categoryId: p.category_id,
      isActive: p.is_active,
      archived: Boolean(p.archived_at),
      cateringEligible: p.is_catering_eligible,
      limitedTime: Boolean(p.available_from || p.available_until),
      price: prices.length === 0 ? money(p.base_price_cents) : prices[0] === prices.at(-1) ? money(prices[0]) : `${money(prices[0])} – ${money(prices.at(-1)!)}`,
      imagePath: p.image_url,
    };
  });
}

export async function listAdminGroups(): Promise<AdminGroup[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("modifier_groups")
    .select(
      "id, slug, name, description, selection_type, is_required, min_selections, max_selections, max_quantity_per_option, quantity_unit, charge_per_quantity, is_active, archived_at, modifier_options(id, name, description, price_delta_cents, is_default, max_quantity, allergens, is_active, archived_at, sort_order)",
    )
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`Menu: ${error.message}`);
  return (data ?? []).map((g) => ({
    id: g.id,
    slug: g.slug,
    name: g.name,
    description: g.description,
    selectionType: g.selection_type,
    isRequired: g.is_required,
    minSelections: g.min_selections,
    maxSelections: g.max_selections,
    maxQuantityPerOption: g.max_quantity_per_option,
    quantityUnit: g.quantity_unit,
    chargePerQuantity: g.charge_per_quantity,
    isActive: g.is_active,
    archived: Boolean(g.archived_at),
    options: [...(g.modifier_options ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((o) => ({
        id: o.id,
        name: o.name,
        description: o.description,
        priceDeltaCents: o.price_delta_cents,
        isDefault: o.is_default,
        maxQuantity: o.max_quantity,
        allergens: o.allergens,
        isActive: o.is_active,
        archived: Boolean(o.archived_at),
      })),
  }));
}

/** How many products each group is on. */
export async function groupProductCounts(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from("product_modifier_groups").select("modifier_group_id");
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.modifier_group_id, (counts.get(row.modifier_group_id) ?? 0) + 1);
  return counts;
}

export interface AdminProduct {
  draft: ProductDraft;
  archived: boolean;
  usage: Usage;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

export async function getAdminProduct(id: string): Promise<AdminProduct | null> {
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("products")
    .select(
      "id, name, slug, description, category_id, image_url, base_price_cents, allergens, dietary_tags, calories, is_catering_eligible, is_active, archived_at, available_from, available_until, created_at, updated_at, updated_by, product_sizes(id, name, price_cents, volume_oz, is_default, is_active, archived_at, sort_order), product_modifier_groups(modifier_group_id, visible_when_option_id, override_is_required, override_min_selections, override_max_selections, sort_order)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;
  const [{ data: usage }, { data: editor }] = await Promise.all([
    supabase.rpc("admin_menu_usage", { p_kind: "product", p_id: id }),
    p.updated_by ? supabase.from("profiles").select("full_name, email").eq("id", p.updated_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    archived: Boolean(p.archived_at),
    usage: (usage ?? {}) as Usage,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    updatedBy: editor ? editor.full_name || editor.email : null,
    draft: {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description ?? "",
      categoryId: p.category_id,
      imagePath: p.image_url,
      basePrice: centsToInput(p.base_price_cents),
      sizes: [...(p.product_sizes ?? [])]
        .filter((s) => !s.archived_at)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({
          key: s.id,
          id: s.id,
          name: s.name,
          price: centsToInput(s.price_cents),
          volumeOz: s.volume_oz ? String(s.volume_oz) : "",
          isDefault: s.is_default,
        })),
      groups: [...(p.product_modifier_groups ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({
          groupId: l.modifier_group_id,
          visibleWhenOptionId: l.visible_when_option_id,
          overrideIsRequired: l.override_is_required,
          overrideMinSelections: l.override_min_selections,
          overrideMaxSelections: l.override_max_selections,
        })),
      allergens: p.allergens,
      dietaryTags: p.dietary_tags,
      calories: p.calories === null ? "" : String(p.calories),
      cateringEligible: p.is_catering_eligible,
      isActive: p.is_active,
      availableFrom: p.available_from,
      availableUntil: p.available_until,
    },
  };
}

export interface AdminGroupDetail {
  draft: GroupDraft;
  archived: boolean;
  usage: Usage;
  products: { id: string; name: string }[];
}

export async function getAdminGroup(id: string): Promise<AdminGroupDetail | null> {
  const groups = await listAdminGroups();
  const group = groups.find((g) => g.id === id);
  if (!group) return null;
  const supabase = await createClient();
  const [{ data: usage }, { data: links }] = await Promise.all([
    supabase.rpc("admin_menu_usage", { p_kind: "modifier_group", p_id: id }),
    supabase.from("product_modifier_groups").select("product:products(id, name)").eq("modifier_group_id", id),
  ]);
  return {
    archived: group.archived,
    usage: (usage ?? {}) as Usage,
    products: (links ?? []).flatMap((l) => (l.product ? [{ id: l.product.id, name: l.product.name }] : [])),
    draft: {
      id: group.id,
      name: group.name,
      slug: group.slug,
      description: group.description ?? "",
      selectionType: group.selectionType,
      isRequired: group.isRequired,
      minSelections: String(group.minSelections),
      maxSelections: group.maxSelections === null ? "" : String(group.maxSelections),
      maxQuantityPerOption: String(group.maxQuantityPerOption),
      quantityUnit: group.quantityUnit ?? "",
      chargePerQuantity: group.chargePerQuantity,
      isActive: group.isActive,
      options: group.options
        .filter((o) => !o.archived)
        .map((o) => ({
          key: o.id,
          id: o.id,
          name: o.name,
          description: o.description ?? "",
          price: o.priceDeltaCents === 0 ? "" : centsToInput(o.priceDeltaCents),
          isDefault: o.isDefault,
          maxQuantity: String(o.maxQuantity),
          allergens: o.allergens,
        })),
    },
  };
}

/** "Used in 12 orders, 2 favorites" (empty when never used). */
export function usageSentence(usage: Usage): string {
  const labels: Record<string, [string, string]> = {
    orders: ["order", "orders"],
    favorites: ["favorite", "favorites"],
    event_menus: ["event menu", "event menus"],
    collections: ["collection", "collections"],
    catering: ["catering request or quote", "catering requests and quotes"],
    rewards: ["reward", "rewards"],
    products: ["product", "products"],
  };
  const parts = Object.entries(usage)
    .filter(([, n]) => Number(n) > 0)
    .map(([key, n]) => `${n} ${Number(n) === 1 ? (labels[key]?.[0] ?? key) : (labels[key]?.[1] ?? key)}`);
  return parts.join(", ");
}

/**
 * The menu editor's rules, as pure functions: what makes a product or a
 * modifier group valid (the same rules admin_save_product and
 * admin_save_modifier_group enforce, checked here first for instant, field-by
 * -field messages), and the live preview, which feeds the draft through the
 * very function the customer's product sheet is built with
 * (buildProductDetail), so the preview cannot drift from what customers see.
 */
import { slugify } from "@/lib/events/window";
import { buildProductDetail, type Allergen, type DietaryTag, type ProductDetail } from "@/lib/menu/model";
import type { CatalogData } from "@/lib/menu/catalog";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "5", "5.5", "5.50", "$5.50" -> 550; anything else -> null. */
export function parseDollars(text: string, { allowNegative = false }: { allowNegative?: boolean } = {}): number | null {
  const trimmed = text.trim().replace(/^\$/, "").replace(/^(-)\$/, "$1");
  const pattern = allowNegative ? /^-?\d{1,4}(\.\d{1,2})?$/ : /^\d{1,4}(\.\d{1,2})?$/;
  if (!pattern.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

export const centsToInput = (cents: number) => (cents / 100).toFixed(2);

// ---------------------------------------------------------------------------
// The shapes the editor works with.
// ---------------------------------------------------------------------------

export interface AdminOption {
  id: string;
  name: string;
  description: string | null;
  priceDeltaCents: number;
  isDefault: boolean;
  maxQuantity: number;
  allergens: Allergen[];
  isActive: boolean;
  archived: boolean;
}

export interface AdminGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  selectionType: "single" | "multi";
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  maxQuantityPerOption: number;
  quantityUnit: string | null;
  chargePerQuantity: boolean;
  isActive: boolean;
  archived: boolean;
  options: AdminOption[];
}

export interface SizeDraft {
  /** Stable key for React lists. */
  key: string;
  id: string | null;
  name: string;
  price: string;
  volumeOz: string;
  isDefault: boolean;
}

/**
 * A product's link to a group. The per-product overrides are not edited here
 * (none are set today); they are carried so the preview matches what
 * customers see, and the database keeps them on save.
 */
export interface GroupLinkDraft {
  groupId: string;
  visibleWhenOptionId: string | null;
  overrideIsRequired?: boolean | null;
  overrideMinSelections?: number | null;
  overrideMaxSelections?: number | null;
}

export interface ProductDraft {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  categoryId: string | null;
  imagePath: string | null;
  /** Dollars, for items without sizes. */
  basePrice: string;
  sizes: SizeDraft[];
  groups: GroupLinkDraft[];
  allergens: Allergen[];
  dietaryTags: DietaryTag[];
  calories: string;
  cateringEligible: boolean;
  isActive: boolean;
  /** Limited time: Honolulu instants as ISO strings, or null. */
  availableFrom: string | null;
  availableUntil: string | null;
}

export type FieldErrors = Record<string, string>;

export function effectiveSlug(draft: Pick<ProductDraft, "slug" | "name">): string {
  return draft.slug.trim() || slugify(draft.name).slice(0, 80).replace(/-+$/, "");
}

/** Every problem with a product draft, keyed by field ("sizes.1.price", "groups.0"). Empty = savable. */
export function validateProductDraft(draft: ProductDraft, groups: readonly AdminGroup[]): FieldErrors {
  const errors: FieldErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Give the product a name.";
  else if (name.length > 80) errors.name = "Keep the name to 80 characters.";

  const slug = effectiveSlug(draft);
  if (!slug) errors.slug = "Add a web address, or a name with letters or numbers.";
  else if (!SLUG_PATTERN.test(slug) || slug.length > 80) errors.slug = "Use lowercase letters, numbers and single hyphens.";
  if (draft.description.length > 1000) errors.description = "Keep the description to 1,000 characters.";

  if (draft.calories.trim()) {
    const calories = Number(draft.calories);
    if (!/^\d+$/.test(draft.calories.trim()) || calories > 5000) errors.calories = "A whole number from 0 to 5,000.";
  }

  if (draft.sizes.length === 0) {
    const price = parseDollars(draft.basePrice);
    if (price === null || price > 100_000) errors.basePrice = "Enter a price like 4.50 (up to $1,000), or add sizes.";
  } else {
    if (draft.sizes.length > 10) errors.sizes = "Up to 10 sizes.";
    const seen = new Set<string>();
    draft.sizes.forEach((size, index) => {
      const sizeName = size.name.trim();
      if (!sizeName) errors[`sizes.${index}.name`] = "Name this size.";
      else if (sizeName.length > 40) errors[`sizes.${index}.name`] = "Up to 40 characters.";
      else if (seen.has(sizeName.toLowerCase())) errors[`sizes.${index}.name`] = "Each size needs a different name.";
      seen.add(sizeName.toLowerCase());
      const price = parseDollars(size.price);
      if (price === null || price > 100_000) errors[`sizes.${index}.price`] = "A price like 5.25.";
      if (size.volumeOz.trim() && (!/^\d+$/.test(size.volumeOz.trim()) || Number(size.volumeOz) < 1 || Number(size.volumeOz) > 128)) {
        errors[`sizes.${index}.volumeOz`] = "Ounces from 1 to 128, or blank.";
      }
    });
    const defaults = draft.sizes.filter((s) => s.isDefault).length;
    if (defaults !== 1) errors.sizes = "Pick exactly one default size.";
  }

  const byId = new Map(groups.map((g) => [g.id, g]));
  const linked = new Set<string>();
  draft.groups.forEach((link, index) => {
    const group = byId.get(link.groupId);
    if (!group || group.archived) {
      errors[`groups.${index}`] = "This group no longer exists.";
      return;
    }
    if (linked.has(group.id)) errors[`groups.${index}`] = `${group.name} is added twice.`;
    linked.add(group.id);
    if (group.selectionType === "single" && group.isRequired && !group.options.some((o) => o.isDefault && o.isActive && !o.archived)) {
      errors[`groups.${index}`] = `${group.name} is required and single-choice, so it needs a default option. Set one on the Modifiers page.`;
    }
  });
  // Which group each group's "Only show when" option belongs to.
  const controller = new Map<string, string>();
  draft.groups.forEach((link, index) => {
    if (!link.visibleWhenOptionId) return;
    const owner = groups.find((g) => g.options.some((o) => o.id === link.visibleWhenOptionId));
    if (!owner || owner.id === link.groupId || !linked.has(owner.id)) {
      errors[`groups.${index}.visibleWhen`] = "Pick an option from another group on this product.";
      return;
    }
    controller.set(link.groupId, owner.id);
  });
  // A loop (A shown only when B's option is picked, B only when A's) would
  // hide every group in it for good.
  draft.groups.forEach((link, index) => {
    const seen = new Set<string>([link.groupId]);
    for (let at = controller.get(link.groupId); at; at = controller.get(at)) {
      if (seen.has(at)) {
        errors[`groups.${index}.visibleWhen`] ??= "These \"Only show when\" rules depend on each other in a loop, so the groups would never show.";
        return;
      }
      seen.add(at);
    }
  });

  if (draft.availableFrom && draft.availableUntil && Date.parse(draft.availableUntil) <= Date.parse(draft.availableFrom)) {
    errors.availableUntil = "The end must be after the start.";
  }
  return errors;
}

/** The arguments admin_save_product takes. */
export function productDraftToRpc(draft: ProductDraft) {
  return {
    p_product: {
      id: draft.id,
      name: draft.name.trim(),
      slug: effectiveSlug(draft),
      description: draft.description.trim(),
      category_id: draft.categoryId,
      image_url: draft.imagePath ?? "",
      base_price_cents: draft.sizes.length === 0 ? (parseDollars(draft.basePrice) ?? 0) : 0,
      allergens: draft.allergens,
      dietary_tags: draft.dietaryTags,
      calories: draft.calories.trim() ? Number(draft.calories) : null,
      is_catering_eligible: draft.cateringEligible,
      is_active: draft.isActive,
      available_from: draft.availableFrom ?? "",
      available_until: draft.availableUntil ?? "",
    },
    p_sizes: draft.sizes.map((s) => ({
      id: s.id,
      name: s.name.trim(),
      price_cents: parseDollars(s.price) ?? 0,
      volume_oz: s.volumeOz.trim() ? Number(s.volumeOz) : null,
      is_default: s.isDefault,
    })),
    p_groups: draft.groups.map((g) => ({ group_id: g.groupId, visible_when_option_id: g.visibleWhenOptionId })),
  };
}

// ---------------------------------------------------------------------------
// Modifier groups.
// ---------------------------------------------------------------------------

export interface OptionDraft {
  key: string;
  id: string | null;
  name: string;
  description: string;
  price: string;
  isDefault: boolean;
  maxQuantity: string;
  allergens: Allergen[];
}

export interface GroupDraft {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  selectionType: "single" | "multi";
  isRequired: boolean;
  minSelections: string;
  maxSelections: string;
  maxQuantityPerOption: string;
  quantityUnit: string;
  chargePerQuantity: boolean;
  isActive: boolean;
  options: OptionDraft[];
}

const wholeIn = (text: string, min: number, max: number) => /^\d+$/.test(text.trim()) && Number(text) >= min && Number(text) <= max;

export function validateGroupDraft(draft: GroupDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name.trim()) errors.name = "Give the group a name.";
  else if (draft.name.trim().length > 60) errors.name = "Keep the name to 60 characters.";
  const slug = draft.slug.trim() || slugify(draft.name).slice(0, 80);
  if (!slug || !SLUG_PATTERN.test(slug)) errors.slug = "Use lowercase letters, numbers and single hyphens.";

  const single = draft.selectionType === "single";
  const min = single ? (draft.isRequired ? 1 : 0) : Number(draft.minSelections || 0);
  const max = single ? 1 : draft.maxSelections.trim() ? Number(draft.maxSelections) : null;
  if (!single) {
    if (!wholeIn(draft.minSelections || "0", 0, 20)) errors.minSelections = "A whole number from 0 to 20.";
    if (draft.maxSelections.trim() && !wholeIn(draft.maxSelections, 1, 20)) errors.maxSelections = "A whole number from 1 to 20, or blank for no limit.";
    if (draft.isRequired && min < 1) errors.minSelections = "A required group needs at least 1 choice.";
    if (!draft.isRequired && min > 0) errors.minSelections = "Only a required group has a minimum. Tick Required, or set this to 0.";
    if (max !== null && !errors.maxSelections && !errors.minSelections && max < min) errors.maxSelections = "The most choices can't be fewer than the least.";
    if (!wholeIn(draft.maxQuantityPerOption || "1", 1, 20)) errors.maxQuantityPerOption = "A whole number from 1 to 20.";
  }
  const unit = draft.quantityUnit.trim();
  if (unit && !/^[a-z][a-z ]{0,19}$/.test(unit)) errors.quantityUnit = "A short lowercase word, like pump or shot.";

  if (draft.options.length === 0) errors.options = "Add at least one option.";
  if (draft.options.length > 50) errors.options = "Up to 50 options.";
  const perOption = single ? 1 : Number(draft.maxQuantityPerOption || 1);
  const seen = new Set<string>();
  draft.options.forEach((option, index) => {
    const name = option.name.trim();
    if (!name) errors[`options.${index}.name`] = "Name this option.";
    else if (name.length > 60) errors[`options.${index}.name`] = "Up to 60 characters.";
    else if (seen.has(name.toLowerCase())) errors[`options.${index}.name`] = "Each option needs a different name.";
    seen.add(name.toLowerCase());
    const price = option.price.trim() ? parseDollars(option.price, { allowNegative: true }) : 0;
    if (price === null || Math.abs(price) > 100_000) errors[`options.${index}.price`] = "An amount like 0.75 (or -0.50 for a discount).";
    if (!single && !wholeIn(option.maxQuantity || "1", 1, perOption)) errors[`options.${index}.maxQuantity`] = `From 1 to ${perOption}.`;
    if (option.description.length > 200) errors[`options.${index}.description`] = "Up to 200 characters.";
  });

  const defaults = draft.options.filter((o) => o.isDefault).length;
  if (single && defaults > 1) errors.options = "A single-choice group has at most one default.";
  if (single && draft.isRequired && defaults !== 1) errors.options = "A required single-choice group needs a default option, so customers start with a valid choice.";
  if (!single && max !== null && defaults > max) errors.options = `More defaults than the group allows (${max} at most).`;
  return errors;
}

export function groupDraftToRpc(draft: GroupDraft) {
  const single = draft.selectionType === "single";
  return {
    p_group: {
      id: draft.id,
      name: draft.name.trim(),
      slug: draft.slug.trim() || slugify(draft.name).slice(0, 80),
      description: draft.description.trim(),
      selection_type: draft.selectionType,
      is_required: draft.isRequired,
      min_selections: single ? (draft.isRequired ? 1 : 0) : Number(draft.minSelections || 0),
      max_selections: single ? 1 : draft.maxSelections.trim() ? Number(draft.maxSelections) : null,
      max_quantity_per_option: single ? 1 : Number(draft.maxQuantityPerOption || 1),
      quantity_unit: draft.quantityUnit.trim() || null,
      charge_per_quantity: draft.chargePerQuantity,
      is_active: draft.isActive,
    },
    p_options: draft.options.map((o) => ({
      id: o.id,
      name: o.name.trim(),
      description: o.description.trim(),
      price_delta_cents: o.price.trim() ? (parseDollars(o.price, { allowNegative: true }) ?? 0) : 0,
      is_default: o.isDefault,
      max_quantity: single ? 1 : Number(o.maxQuantity || 1),
      allergens: o.allergens,
    })),
  };
}

// ---------------------------------------------------------------------------
// The live preview.
// ---------------------------------------------------------------------------

export const PREVIEW_PRODUCT_ID = "00000000-0000-4000-8000-00000000beef";

/**
 * The draft as the customer's product sheet would show it at the cafe, now:
 * built by buildProductDetail from a one-product catalogue. Prices that do
 * not parse yet show as $0.00; groups and options that are switched off are
 * left out, as they are for customers. Null only when the draft has no name.
 */
export function previewDetail(
  draft: ProductDraft,
  groups: readonly AdminGroup[],
  category: { id: string; name: string; slug: string } | null,
  supabaseUrl: string,
): ProductDetail | null {
  if (!draft.name.trim()) return null;
  const linked = draft.groups.map((link) => groups.find((g) => g.id === link.groupId)).filter((g): g is AdminGroup => Boolean(g));
  const liveGroups = linked.filter((g) => g.isActive && !g.archived);

  const catalog: CatalogData = {
    categories: category ? [{ id: category.id, name: category.name, slug: category.slug, description: null, sort_order: 0 }] : [],
    products: [
      {
        id: PREVIEW_PRODUCT_ID,
        category_id: category?.id ?? null,
        name: draft.name.trim(),
        slug: "preview",
        description: draft.description.trim() || null,
        image_url: draft.imagePath,
        base_price_cents: draft.sizes.length === 0 ? (parseDollars(draft.basePrice) ?? 0) : 0,
        allergens: draft.allergens,
        dietary_tags: draft.dietaryTags,
        calories: draft.calories.trim() && /^\d+$/.test(draft.calories.trim()) ? Number(draft.calories) : null,
        sort_order: 0,
        // The window is shown separately; the preview is the item itself.
        available_from: null,
        available_until: null,
      },
    ],
    sizes: draft.sizes.map((s, index) => ({
      id: s.id ?? `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      product_id: PREVIEW_PRODUCT_ID,
      name: s.name.trim() || `Size ${index + 1}`,
      price_cents: parseDollars(s.price) ?? 0,
      volume_oz: /^\d+$/.test(s.volumeOz.trim()) ? Number(s.volumeOz) : null,
      is_default: s.isDefault,
      sort_order: index,
    })),
    groups: liveGroups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      selection_type: g.selectionType,
      is_required: g.isRequired,
      min_selections: g.minSelections,
      max_selections: g.maxSelections,
      max_quantity_per_option: g.maxQuantityPerOption,
      quantity_unit: g.quantityUnit,
      charge_per_quantity: g.chargePerQuantity,
    })),
    options: liveGroups.flatMap((g) =>
      g.options
        .filter((o) => o.isActive && !o.archived)
        .map((o, index) => ({
          id: o.id,
          modifier_group_id: g.id,
          name: o.name,
          price_delta_cents: o.priceDeltaCents,
          is_default: o.isDefault,
          max_quantity: o.maxQuantity,
          allergens: o.allergens,
          sort_order: index,
        })),
    ),
    links: draft.groups
      .filter((link) => liveGroups.some((g) => g.id === link.groupId))
      .map((link, index) => ({
        product_id: PREVIEW_PRODUCT_ID,
        modifier_group_id: link.groupId,
        sort_order: index,
        override_is_required: link.overrideIsRequired ?? null,
        override_min_selections: link.overrideMinSelections ?? null,
        override_max_selections: link.overrideMaxSelections ?? null,
        visible_when_option_id: link.visibleWhenOptionId,
        created_at: "",
      })),
    collections: [],
    collectionProducts: [],
    eventMenuItems: [],
  };

  return buildProductDetail(catalog, "preview", {
    location: { id: "preview", type: "cafe" },
    soldOut: { productIds: [], optionIds: [] },
    now: new Date(0),
    supabaseUrl,
  });
}

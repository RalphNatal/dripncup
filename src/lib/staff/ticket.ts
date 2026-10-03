/**
 * How a drink reads on a ticket and a cup label.
 *
 * Every selection gets its own line, always in the order a barista builds
 * the drink: temperature, milk, shots, flavours and pumps, sweetness, ice,
 * toppings, then anything else. The order comes from the modifier group
 * (its slug, else its name), not from the order the customer tapped, so two
 * tickets for the same drink read the same. Pure; the group details come
 * from the catalogue.
 */
import type { Allergen } from "@/lib/menu/model";
import { describeSnapshotModifier, type SnapshotModifier } from "@/lib/orders/detail";

import type { StaffOrderItem } from "./queue";

export interface GroupMeta {
  slug: string;
  name: string;
  sortOrder: number;
}

export interface CatalogMeta {
  groups: Record<string, GroupMeta>;
  /** Allergens by product id. */
  productAllergens: Record<string, Allergen[]>;
  /** Allergens by modifier option id (oat milk: gluten; macadamia syrup: tree nuts). */
  optionAllergens: Record<string, Allergen[]>;
}

export const EMPTY_CATALOG_META: CatalogMeta = { groups: {}, productAllergens: {}, optionAllergens: {} };

/** Build order. Checked top to bottom, first match wins ("shave ice flavors" is a flavour). */
const BUILD_ORDER: readonly { pattern: RegExp }[] = [
  { pattern: /temp|hot.or.iced/ }, // 0 temperature
  { pattern: /milk/ }, // 1 milk
  { pattern: /shot|espresso/ }, // 2 shots
  { pattern: /syrup|flavou?r|sauce|pump/ }, // 3 flavours / pumps
  { pattern: /sweet|sugar/ }, // 4 sweetness
  { pattern: /^ice\b/ }, // 5 ice
  { pattern: /topping|add.?on|special|extra|foam|whip/ }, // 6 toppings and add-ons
];

/** Position in the build order; 7 for groups that match nothing. */
export function buildRank(group: { slug?: string; name?: string }): number {
  for (const key of [group.slug, group.name]) {
    if (!key) continue;
    const text = key.toLowerCase();
    const index = BUILD_ORDER.findIndex((step) => step.pattern.test(text));
    if (index >= 0) return index;
  }
  return BUILD_ORDER.length;
}

/** The item's selections in build order, each as one line ("Oat milk", "Vanilla (2 pumps)"). */
export function ticketLines(modifiers: readonly SnapshotModifier[], groups: CatalogMeta["groups"]): string[] {
  return modifiers
    .map((modifier, index) => {
      const group = modifier.group_id ? groups[modifier.group_id] : undefined;
      return {
        modifier,
        index,
        rank: buildRank({ slug: group?.slug, name: group?.name ?? modifier.group_name }),
        sort: group?.sortOrder ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.sort - b.sort || a.index - b.index)
    .map(({ modifier }) => describeSnapshotModifier(modifier));
}

const ALLERGEN_ORDER: readonly Allergen[] = ["dairy", "tree_nuts", "macadamia", "peanuts", "gluten", "soy", "egg", "sesame"];

/** Allergens of the product and every chosen option, de-duplicated, in a fixed order. */
export function itemAllergens(item: Pick<StaffOrderItem, "productId" | "modifiers">, meta: CatalogMeta): Allergen[] {
  const found = new Set<Allergen>();
  for (const allergen of (item.productId && meta.productAllergens[item.productId]) || []) found.add(allergen);
  for (const modifier of item.modifiers) {
    for (const allergen of (modifier.option_id && meta.optionAllergens[modifier.option_id]) || []) found.add(allergen);
  }
  return ALLERGEN_ORDER.filter((a) => found.has(a));
}

/** "Lg", "Med": compact sizes for cup labels. */
export function shortSize(size: string | null): string | null {
  if (!size) return null;
  const known: Record<string, string> = { small: "Sm", medium: "Med", large: "Lg", regular: "Reg" };
  return known[size.toLowerCase()] ?? size;
}

/** One label per drink: an item with quantity 3 prints three labels, numbered across the order. */
export function cupLabels(items: readonly StaffOrderItem[]): { item: StaffOrderItem; index: number; total: number }[] {
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  const labels: { item: StaffOrderItem; index: number; total: number }[] = [];
  for (const item of items) {
    for (let n = 0; n < item.quantity; n += 1) labels.push({ item, index: labels.length + 1, total });
  }
  return labels;
}

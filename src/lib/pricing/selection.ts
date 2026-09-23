/**
 * Working with a customer's modifier selection: which groups are showing,
 * what is preselected, and turning ids into catalogue-priced modifiers.
 */
import type {
  LineSelection,
  ModifierSelection,
  PricingModifierGroup,
  PricingProduct,
  SelectedModifier,
} from "./types";

/** Quantity chosen for an option, treating anything unusable as 0. */
export function quantityOf(modifiers: ModifierSelection, groupId: string, optionId: string): number {
  const value = modifiers[groupId]?.[optionId];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Ids of the groups currently shown.
 *
 * A conditional group appears while its controlling option is selected in a
 * group that is itself showing, so conditions can chain. If the controlling
 * option is not on this product at all (a misconfiguration the database
 * normally prevents), the group is shown: offering an unnecessary choice is
 * safer than hiding a needed one.
 */
export function visibleGroupIds(
  groups: readonly PricingModifierGroup[],
  modifiers: ModifierSelection,
): Set<string> {
  const groupOfOption = new Map<string, string>();
  for (const group of groups) {
    for (const option of group.options) groupOfOption.set(option.id, group.id);
  }

  const visible = new Set<string>();
  for (const group of groups) {
    if (!group.visibleWhenOptionId || !groupOfOption.has(group.visibleWhenOptionId)) {
      visible.add(group.id);
    }
  }

  // Each pass can only reveal more groups, so this settles within
  // groups.length passes.
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      if (visible.has(group.id) || !group.visibleWhenOptionId) continue;
      const controllingGroup = groupOfOption.get(group.visibleWhenOptionId)!;
      if (
        visible.has(controllingGroup) &&
        quantityOf(modifiers, controllingGroup, group.visibleWhenOptionId) > 0
      ) {
        visible.add(group.id);
        changed = true;
      }
    }
  }

  return visible;
}

/**
 * The starting selection for a product: its default size and every default
 * option that is not sold out.
 *
 * Defaults are filled in for hidden groups too, so switching Hot to Iced
 * reveals Ice with its default already chosen. Hidden groups are ignored by
 * validation and pricing, and dropped by `pruneSelection` before the line
 * reaches the cart.
 *
 * A sold-out default is left unselected rather than swapped for another
 * option: silently giving someone nonfat milk instead of whole is worse than
 * asking them to choose.
 */
export function defaultSelection(
  product: PricingProduct,
  groups: readonly PricingModifierGroup[],
): LineSelection {
  const size = product.sizes.find((s) => s.isDefault) ?? product.sizes[0] ?? null;

  const modifiers: ModifierSelection = {};
  for (const group of groups) {
    const limit = group.selectionType === "single" ? 1 : (group.maxSelections ?? Infinity);
    const defaults = group.options.filter((o) => o.isDefault && !o.soldOut).slice(0, limit);
    if (defaults.length > 0) {
      modifiers[group.id] = Object.fromEntries(defaults.map((o) => [o.id, 1]));
    }
  }

  return { sizeId: size?.id ?? null, modifiers };
}

/**
 * The selection as it should be stored on a cart line: only groups that are
 * showing, only known options with a quantity.
 */
export function pruneSelection(
  groups: readonly PricingModifierGroup[],
  modifiers: ModifierSelection,
): ModifierSelection {
  const visible = visibleGroupIds(groups, modifiers);
  const pruned: ModifierSelection = {};

  for (const group of groups) {
    if (!visible.has(group.id)) continue;
    const chosen: Record<string, number> = {};
    for (const option of group.options) {
      const quantity = quantityOf(modifiers, group.id, option.id);
      if (quantity > 0) chosen[option.id] = quantity;
    }
    if (Object.keys(chosen).length > 0) pruned[group.id] = chosen;
  }

  return pruned;
}

/**
 * Catalogue-priced modifiers for the groups that are showing, in display
 * order. Unknown ids are skipped here -- `validateSelection` is what reports
 * them. The result is exactly what an order-item snapshot stores.
 */
export function resolveSelection(
  groups: readonly PricingModifierGroup[],
  modifiers: ModifierSelection,
): SelectedModifier[] {
  const visible = visibleGroupIds(groups, modifiers);
  const resolved: SelectedModifier[] = [];

  for (const group of groups) {
    if (!visible.has(group.id)) continue;
    for (const option of group.options) {
      const quantity = quantityOf(modifiers, group.id, option.id);
      if (quantity === 0) continue;
      resolved.push({
        groupId: group.id,
        groupName: group.name,
        optionId: option.id,
        optionName: option.name,
        quantity,
        priceDeltaCents: option.priceDeltaCents,
        chargePerQuantity: group.chargePerQuantity,
        quantityUnit: group.quantityUnit,
      });
    }
  }

  return resolved;
}

/** Order-independent key for "same drink, same way", used to merge cart lines. */
export function selectionKey(modifiers: ModifierSelection): string {
  return Object.keys(modifiers)
    .sort()
    .map((groupId) => {
      const options = Object.keys(modifiers[groupId])
        .filter((optionId) => quantityOf(modifiers, groupId, optionId) > 0)
        .sort()
        .map((optionId) => `${optionId}:${modifiers[groupId][optionId]}`);
      return options.length ? `${groupId}=${options.join(",")}` : "";
    })
    .filter(Boolean)
    .join("|");
}

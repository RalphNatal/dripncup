/**
 * `validateSelection`: is this a line the cafe can actually make?
 *
 * The product sheet runs it on every change to show inline messages; checkout
 * runs it again on the server against fresh catalogue and availability data,
 * because a browser can send anything.
 */
import { SPECIAL_INSTRUCTIONS_MAX } from "./constants";
import { visibleGroupIds } from "./selection";
import type {
  LineSelection,
  PricingModifierGroup,
  PricingProduct,
  SelectionError,
} from "./types";

/** "pump" -> "pumps"; units are short English nouns entered by the admin. */
export function pluralUnit(unit: string, count: number): string {
  return count === 1 ? unit : `${unit}s`;
}

function requiredMessage(group: PricingModifierGroup): string {
  if (group.selectionType === "single") return `${group.name}: choose one.`;
  const min = Math.max(1, group.minSelections);
  return min === 1 ? `${group.name}: choose at least one.` : `${group.name}: choose at least ${min}.`;
}

/**
 * Every problem with `selection`, or an empty list when it can be ordered.
 *
 * Groups that are hidden (their condition is not met) are skipped entirely,
 * so a leftover Ice choice on a hot drink is not an error; it is simply not
 * charged or kept.
 */
export function validateSelection(
  product: PricingProduct,
  modifierGroups: readonly PricingModifierGroup[],
  selection: LineSelection,
): SelectionError[] {
  const errors: SelectionError[] = [];

  if (product.soldOut) {
    errors.push({
      code: "product_sold_out",
      groupId: null,
      message: `${product.name} is sold out right now.`,
    });
  }

  // Size: required when the product has sizes, forbidden when it has none.
  if (product.sizes.length > 0) {
    if (!selection.sizeId) {
      errors.push({ code: "size_required", groupId: null, message: "Choose a size." });
    } else if (!product.sizes.some((s) => s.id === selection.sizeId)) {
      errors.push({ code: "unknown_size", groupId: null, message: "That size isn't available." });
    }
  } else if (selection.sizeId) {
    errors.push({ code: "unknown_size", groupId: null, message: "That size isn't available." });
  }

  // Anything naming a group this product does not have is tampering or a
  // stale cart; either way it cannot be made.
  const groupsById = new Map(modifierGroups.map((g) => [g.id, g]));
  for (const groupId of Object.keys(selection.modifiers)) {
    if (!groupsById.has(groupId)) {
      errors.push({
        code: "unknown_option",
        groupId: null,
        message: `That option isn't available for ${product.name}.`,
      });
    }
  }

  const visible = visibleGroupIds(modifierGroups, selection.modifiers);

  for (const group of modifierGroups) {
    if (!visible.has(group.id)) continue;

    const entries = selection.modifiers[group.id] ?? {};
    const optionsById = new Map(group.options.map((o) => [o.id, o]));
    let chosen = 0;

    for (const [optionId, raw] of Object.entries(entries)) {
      const option = optionsById.get(optionId);
      if (!option) {
        errors.push({
          code: "unknown_option",
          groupId: group.id,
          optionId,
          message: `That option isn't available for ${product.name}.`,
        });
        continue;
      }

      if (raw === 0) continue;

      const maxQuantity = group.selectionType === "single" ? 1 : option.maxQuantity;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > maxQuantity) {
        const unit = group.quantityUnit ? ` ${pluralUnit(group.quantityUnit, maxQuantity)}` : "";
        errors.push({
          code: "quantity_out_of_range",
          groupId: group.id,
          optionId,
          message:
            maxQuantity === 1
              ? `${option.name} can only be added once.`
              : `${option.name}: choose up to ${maxQuantity}${unit}.`,
        });
        continue;
      }

      chosen += 1;

      if (option.soldOut) {
        errors.push({
          code: "option_sold_out",
          groupId: group.id,
          optionId,
          message: `${option.name} is sold out. Choose something else.`,
        });
      }
    }

    const max = group.selectionType === "single" ? 1 : group.maxSelections;

    if (chosen === 0) {
      if (group.required) {
        errors.push({ code: "required", groupId: group.id, message: requiredMessage(group) });
      }
    } else if (chosen < group.minSelections) {
      errors.push({
        code: "too_few",
        groupId: group.id,
        message: `${group.name}: choose at least ${group.minSelections}.`,
      });
    } else if (max !== null && chosen > max) {
      errors.push({
        code: "too_many",
        groupId: group.id,
        message: max === 1 ? `${group.name}: choose only one.` : `${group.name}: choose up to ${max}.`,
      });
    }
  }

  if ((selection.specialInstructions ?? "").length > SPECIAL_INSTRUCTIONS_MAX) {
    errors.push({
      code: "instructions_too_long",
      groupId: null,
      message: `Keep special instructions to ${SPECIAL_INSTRUCTIONS_MAX} characters or fewer.`,
    });
  }

  return errors;
}

/** Convenience for callers that only need yes/no. */
export function isSelectionValid(
  product: PricingProduct,
  modifierGroups: readonly PricingModifierGroup[],
  selection: LineSelection,
): boolean {
  return validateSelection(product, modifierGroups, selection).length === 0;
}

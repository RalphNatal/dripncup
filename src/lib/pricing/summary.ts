/**
 * Human-readable description of a customised line -- the cart, receipts and
 * the barista ticket all read it the same way.
 */
import { pluralUnit } from "./validate";
import type { SelectedModifier } from "./types";

/** "Oat milk", "Vanilla (2 pumps)", "Extra espresso shot x 2". */
export function describeModifier(modifier: SelectedModifier): string {
  if (modifier.quantity <= 1) return modifier.optionName;
  if (modifier.quantityUnit) {
    return `${modifier.optionName} (${modifier.quantity} ${pluralUnit(modifier.quantityUnit, modifier.quantity)})`;
  }
  return `${modifier.optionName} × ${modifier.quantity}`;
}

export function describeSelection(sizeName: string | null, modifiers: readonly SelectedModifier[]): string[] {
  return [...(sizeName ? [sizeName] : []), ...modifiers.map(describeModifier)];
}

/**
 * Shapes the pricing engine works on.
 *
 * Deliberately free of React, Supabase and the generated database types: the
 * browser (live price in the product sheet) and the server (checkout's
 * `calculateOrderTotal`, Phase 4) must run exactly the same code, and both map
 * their own data into these shapes. See `src/lib/menu/model.ts` for the
 * database -> engine mapping.
 */

/** Integer US cents. Never a float. */
export type Cents = number;

export interface PricingSize {
  id: string;
  name: string;
  /** Absolute price for this size, not a delta. */
  priceCents: Cents;
  isDefault: boolean;
}

export interface PricingModifierOption {
  id: string;
  name: string;
  /** Added per unit, or once -- see the group's `chargePerQuantity`. May be negative. */
  priceDeltaCents: Cents;
  isDefault: boolean;
  /**
   * The most units of this option one line may carry: the lower of the
   * option's and the group's limit. 1 = a plain on/off choice.
   */
  maxQuantity: number;
  /** Sold out at the location being ordered from. */
  soldOut: boolean;
}

export interface PricingModifierGroup {
  id: string;
  name: string;
  selectionType: "single" | "multi";
  /** Effective rules, with any per-product overrides already applied. */
  required: boolean;
  minSelections: number;
  /** Null = no upper limit on how many different options may be chosen. */
  maxSelections: number | null;
  /** true = delta x quantity (extra shots); false = delta once (a flavour, any pumps). */
  chargePerQuantity: boolean;
  /** "pump", "shot" -- how one unit reads. Null = a plain count. */
  quantityUnit: string | null;
  /**
   * Conditional group: shown, validated and charged only while this option
   * (from another group on the product) is selected. Null = always shown.
   */
  visibleWhenOptionId: string | null;
  options: PricingModifierOption[];
}

export interface PricingProduct {
  id: string;
  name: string;
  /** Price for items without sizes (a cookie). Ignored when a size is chosen. */
  basePriceCents: Cents;
  /** Sold out at the location being ordered from. */
  soldOut: boolean;
  /** Active sizes, in display order. Empty for single-price items. */
  sizes: PricingSize[];
}

/**
 * What the customer picked: group id -> option id -> quantity.
 * A missing entry or 0 means "not chosen". Plain JSON, so it persists in the
 * cart and travels to the server unchanged.
 */
export type ModifierSelection = Record<string, Record<string, number>>;

export interface LineSelection {
  sizeId: string | null;
  modifiers: ModifierSelection;
  specialInstructions?: string;
}

/**
 * One chosen option, priced from the catalogue -- never from the client.
 * This is also the shape of an `order_items.modifiers` snapshot entry.
 */
export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  quantity: number;
  priceDeltaCents: Cents;
  chargePerQuantity: boolean;
  quantityUnit: string | null;
}

export type SelectionErrorCode =
  | "product_sold_out"
  | "size_required"
  | "unknown_size"
  | "unknown_option"
  | "required"
  | "too_few"
  | "too_many"
  | "option_sold_out"
  | "quantity_out_of_range"
  | "instructions_too_long";

export interface SelectionError {
  code: SelectionErrorCode;
  /** The group the problem belongs to, for inline messages. Null = the whole line. */
  groupId: string | null;
  optionId?: string;
  message: string;
}

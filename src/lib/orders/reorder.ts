/**
 * Turning a saved drink -- a line from a past order, or a favourite -- back
 * into a cart line, checked against the menu as it is *now*.
 *
 * Nothing from the snapshot is trusted except which product, size and
 * options were chosen. Each line is rebuilt as a selection and put through
 * the same engine the product sheet and checkout use (validateSelection →
 * resolveSelection → calculateLinePrice) at the selected location, so prices
 * always come from the current catalogue and anything that can no longer be
 * made is explained and skipped.
 *
 * Pure: the caller loads the catalogue; this only compares.
 */
import type { NewCartLine } from "@/lib/cart/store";
import type { ProductDetail } from "@/lib/menu/model";
import {
  calculateLinePrice,
  describeSelection,
  pruneSelection,
  resolveSelection,
  validateSelection,
  type ModifierSelection,
} from "@/lib/pricing";

import { describeSnapshotModifier, type SnapshotModifier } from "./detail";

/** A drink as it was saved: order line or favourite. */
export interface SavedLine {
  /** The order item id or favourite id, so the UI can key rows. */
  key: string;
  productId: string | null;
  /** The name when it was saved, for messages about a product that has gone. */
  productName: string;
  sizeId: string | null;
  sizeName: string | null;
  modifiers: readonly SnapshotModifier[];
  quantity: number;
  specialInstructions: string | null;
  /** What one cost then (order lines); null when there is nothing to compare (favourites). */
  previousUnitPriceCents: number | null;
}

interface ReviewBase {
  key: string;
  name: string;
  /** "Large · Oat milk · Vanilla (2 pumps)" pieces. */
  summary: string[];
  quantity: number;
}

export type LineReview =
  | (ReviewBase & {
      status: "ok" | "price_changed";
      unitPriceCents: number;
      previousUnitPriceCents: number | null;
      /** Ready for the cart store, for the selected location. */
      line: NewCartLine;
    })
  | (ReviewBase & { status: "unavailable"; reason: string });

/** The saved option choices as a selection: group → option → quantity. */
export function selectionFromSnapshot(modifiers: readonly SnapshotModifier[]): ModifierSelection {
  const selection: ModifierSelection = {};
  for (const modifier of modifiers) {
    if (!modifier.group_id || !modifier.option_id) continue;
    const quantity = Math.max(1, Math.round(modifier.quantity ?? 1));
    selection[modifier.group_id] = { ...(selection[modifier.group_id] ?? {}), [modifier.option_id]: quantity };
  }
  return selection;
}

function savedSummary(saved: SavedLine): string[] {
  return [...(saved.sizeName ? [saved.sizeName] : []), ...saved.modifiers.map(describeSnapshotModifier)];
}

/**
 * One saved drink against the current menu at `location`. `detail` is the
 * product as the menu builds it for that location (null if it is gone).
 */
export function reviewSavedLine(
  saved: SavedLine,
  detail: ProductDetail | null,
  location: { id: string; name: string },
): LineReview {
  const quantity = Math.max(1, Math.min(99, Math.round(saved.quantity)));
  const unavailable = (reason: string): LineReview => ({
    key: saved.key,
    status: "unavailable",
    name: detail?.product.name ?? saved.productName,
    summary: savedSummary(saved),
    quantity,
    reason,
  });

  if (!detail || !saved.productId || detail.product.id !== saved.productId) {
    return unavailable(`${saved.productName} is no longer on the menu.`);
  }
  const { product, groups } = detail;
  if (!detail.onLocationMenu) return unavailable(`Not on the menu at ${location.name}.`);
  if (product.soldOut) return unavailable(`Sold out at ${location.name} right now.`);

  // The size.
  let sizeId = saved.sizeId;
  if (product.sizes.length === 0) {
    sizeId = null;
  } else if (!sizeId || !product.sizes.some((s) => s.id === sizeId)) {
    return unavailable(
      saved.sizeName ? `The ${saved.sizeName} size is no longer offered.` : "This item now comes in sizes; choose one from the menu.",
    );
  }

  // Every saved option must still exist, and be in stock here.
  for (const modifier of saved.modifiers) {
    const group = groups.find((g) => g.id === modifier.group_id);
    const option = group?.options.find((o) => o.id === modifier.option_id);
    const name = modifier.option_name ?? "One of the options";
    if (!option) return unavailable(`${name} is no longer available.`);
    if (option.soldOut) return unavailable(`${name} is sold out at ${location.name} right now.`);
  }

  const selection = selectionFromSnapshot(saved.modifiers);
  const errors = validateSelection(product, groups, {
    sizeId,
    modifiers: selection,
    specialInstructions: saved.specialInstructions ?? "",
  }).filter((e) => e.code !== "product_sold_out");
  if (errors.length > 0) return unavailable(`The choices for this item have changed: ${errors[0].message}`);

  const size = product.sizes.find((s) => s.id === sizeId) ?? null;
  const resolved = resolveSelection(groups, selection);
  const unitPriceCents = calculateLinePrice(product, size, resolved, 1);
  const summary = describeSelection(size?.name ?? null, resolved);
  const changed = saved.previousUnitPriceCents !== null && saved.previousUnitPriceCents !== unitPriceCents;

  return {
    key: saved.key,
    status: changed ? "price_changed" : "ok",
    name: product.name,
    summary,
    quantity,
    unitPriceCents,
    previousUnitPriceCents: saved.previousUnitPriceCents,
    line: {
      locationId: location.id,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      sizeId: size?.id ?? null,
      sizeName: size?.name ?? null,
      selection: pruneSelection(groups, selection),
      summary,
      specialInstructions: (saved.specialInstructions ?? "").trim(),
      quantity,
      unitPriceCents,
    },
  };
}

export interface ReorderReview {
  orderId: string;
  orderNumber: string;
  lines: LineReview[];
  location: {
    ordered: { id: string; name: string };
    selected: { id: string; name: string };
    /** The order was for another location than the one now selected. */
    mismatch: boolean;
    /** The order's location is still offered, so the customer can switch to it. */
    canSwitch: boolean;
  };
  /** Whether the selected location is taking orders now (the menu's rule). */
  ordering: { canOrder: boolean; reason: string | null };
}

/**
 * Where the order was from versus where the customer is ordering now. The
 * review is always priced at the selected location; switching is offered
 * only if the original location is still taking customers.
 */
export function reorderLocation(
  ordered: { id: string; name: string },
  selected: { id: string; name: string },
  offeredLocationIds: readonly string[],
): ReorderReview["location"] {
  return {
    ordered,
    selected,
    mismatch: ordered.id !== selected.id,
    canSwitch: ordered.id !== selected.id && offeredLocationIds.includes(ordered.id),
  };
}

/** Lines that can go in the cart. */
export function addableLines(review: { lines: readonly LineReview[] }) {
  return review.lines.filter((l): l is Extract<LineReview, { status: "ok" | "price_changed" }> => l.status !== "unavailable");
}

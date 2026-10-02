import { describe, expect, it } from "vitest";

import type { DetailGroup, ProductDetail } from "@/lib/menu/model";

import { addableLines, reorderLocation, reviewSavedLine, selectionFromSnapshot, type SavedLine } from "./reorder";

const CAFE = { id: "cafe", name: "Drincup Cafe — Kapiolani" };

function milk(overrides: Partial<DetailGroup> = {}): DetailGroup {
  return {
    id: "milk",
    name: "Milk",
    description: null,
    selectionType: "single",
    required: true,
    minSelections: 1,
    maxSelections: 1,
    chargePerQuantity: true,
    quantityUnit: null,
    visibleWhenOptionId: null,
    options: [
      { id: "whole", name: "Whole", priceDeltaCents: 0, isDefault: true, maxQuantity: 1, soldOut: false, allergens: [] },
      { id: "oat", name: "Oat milk", priceDeltaCents: 80, isDefault: false, maxQuantity: 1, soldOut: false, allergens: [] },
    ],
    ...overrides,
  };
}

const syrups: DetailGroup = {
  id: "syrups",
  name: "Syrups",
  description: null,
  selectionType: "multi",
  required: false,
  minSelections: 0,
  maxSelections: 3,
  chargePerQuantity: false,
  quantityUnit: "pump",
  visibleWhenOptionId: null,
  options: [{ id: "vanilla", name: "Vanilla", priceDeltaCents: 75, isDefault: false, maxQuantity: 6, soldOut: false, allergens: [] }],
};

function latte(overrides: { groups?: DetailGroup[]; soldOut?: boolean; onLocationMenu?: boolean; mediumPrice?: number } = {}): ProductDetail {
  return {
    product: {
      id: "latte",
      slug: "latte",
      name: "Latte",
      description: null,
      imageUrl: null,
      basePriceCents: 0,
      soldOut: overrides.soldOut ?? false,
      sizes: [
        { id: "small", name: "Small", priceCents: 475, isDefault: false, volumeOz: 12 },
        { id: "medium", name: "Medium", priceCents: overrides.mediumPrice ?? 575, isDefault: true, volumeOz: 16 },
      ],
      allergens: [],
      dietaryTags: [],
      calories: null,
      categoryName: "Coffee",
    },
    groups: overrides.groups ?? [milk(), syrups],
    onLocationMenu: overrides.onLocationMenu ?? true,
  };
}

/** Medium latte, oat milk, vanilla x2: 575 + 80 + 75 = 730 a cup, bought as two. */
function savedLatte(overrides: Partial<SavedLine> = {}): SavedLine {
  return {
    key: "item-1",
    productId: "latte",
    productName: "Latte",
    sizeId: "medium",
    sizeName: "Medium",
    modifiers: [
      { group_id: "milk", group_name: "Milk", option_id: "oat", option_name: "Oat milk", quantity: 1, price_delta_cents: 80 },
      { group_id: "syrups", group_name: "Syrups", option_id: "vanilla", option_name: "Vanilla", quantity: 2, price_delta_cents: 75, quantity_unit: "pump" },
    ],
    quantity: 2,
    specialInstructions: "Extra hot",
    previousUnitPriceCents: 730,
    ...overrides,
  };
}

describe("selectionFromSnapshot", () => {
  it("turns snapshot modifiers back into group → option → quantity", () => {
    expect(selectionFromSnapshot(savedLatte().modifiers)).toEqual({ milk: { oat: 1 }, syrups: { vanilla: 2 } });
  });

  it("ignores entries without ids", () => {
    expect(selectionFromSnapshot([{ option_name: "Mystery" }])).toEqual({});
  });
});

describe("reviewSavedLine", () => {
  it("adds an unchanged drink at the current price, for the selected location", () => {
    const review = reviewSavedLine(savedLatte(), latte(), CAFE);
    expect(review.status).toBe("ok");
    if (review.status === "unavailable") throw new Error("expected addable");
    expect(review.unitPriceCents).toBe(730);
    expect(review.line).toMatchObject({
      locationId: "cafe",
      productId: "latte",
      sizeId: "medium",
      selection: { milk: { oat: 1 }, syrups: { vanilla: 2 } },
      quantity: 2,
      specialInstructions: "Extra hot",
      unitPriceCents: 730,
    });
    expect(review.summary).toEqual(["Medium", "Oat milk", "Vanilla (2 pumps)"]);
  });

  it("flags a price change and uses the new price, never the snapshot's", () => {
    const review = reviewSavedLine(savedLatte(), latte({ mediumPrice: 625 }), CAFE);
    expect(review.status).toBe("price_changed");
    if (review.status === "unavailable") throw new Error("expected addable");
    expect(review.previousUnitPriceCents).toBe(730);
    expect(review.unitPriceCents).toBe(780);
    expect(review.line.unitPriceCents).toBe(780);
  });

  it("never reports a price change for a favourite (nothing to compare)", () => {
    const review = reviewSavedLine(savedLatte({ previousUnitPriceCents: null }), latte({ mediumPrice: 625 }), CAFE);
    expect(review.status).toBe("ok");
  });

  it.each([
    ["the product is gone", savedLatte(), null, /no longer on the menu/],
    ["the product is sold out here", savedLatte(), latte({ soldOut: true }), /Sold out at Drincup Cafe/],
    ["this location doesn't carry it", savedLatte(), latte({ onLocationMenu: false }), /Not on the menu at Drincup Cafe/],
    ["the size was removed", savedLatte({ sizeId: "venti", sizeName: "Venti" }), latte(), /The Venti size is no longer offered/],
  ])("skips the line when %s", (_label, saved, detail, reason) => {
    const review = reviewSavedLine(saved, detail, CAFE);
    expect(review.status).toBe("unavailable");
    if (review.status !== "unavailable") throw new Error("expected unavailable");
    expect(review.reason).toMatch(reason);
    expect(review.quantity).toBe(2);
  });

  it("skips the line, naming the option, when an option is sold out", () => {
    const soldOutOat = milk({
      options: milk().options.map((o) => (o.id === "oat" ? { ...o, soldOut: true } : o)),
    });
    const review = reviewSavedLine(savedLatte(), latte({ groups: [soldOutOat, syrups] }), CAFE);
    expect(review).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/^Oat milk is sold out/) });
  });

  it("skips the line when an option no longer exists", () => {
    const review = reviewSavedLine(savedLatte(), latte({ groups: [milk(), { ...syrups, options: [] }] }), CAFE);
    expect(review).toMatchObject({ status: "unavailable", reason: "Vanilla is no longer available." });
  });

  it("skips the line when the menu now needs a choice the saved drink never made", () => {
    const sweetness: DetailGroup = {
      ...milk(),
      id: "sweetness",
      name: "Sweetness",
      options: [{ id: "full", name: "Full", priceDeltaCents: 0, isDefault: true, maxQuantity: 1, soldOut: false, allergens: [] }],
    };
    const review = reviewSavedLine(savedLatte(), latte({ groups: [milk(), syrups, sweetness] }), CAFE);
    expect(review).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/choices for this item have changed/) });
  });
});

describe("reorderLocation", () => {
  const event = { id: "event", name: "Kakaʻako pop-up" };

  it("is quiet when the order was from the selected location", () => {
    expect(reorderLocation(CAFE, CAFE, ["cafe"])).toMatchObject({ mismatch: false, canSwitch: false });
  });

  it("offers to switch when the order's location is still offered", () => {
    expect(reorderLocation(event, CAFE, ["cafe", "event"])).toMatchObject({ mismatch: true, canSwitch: true });
  });

  it("notes the mismatch but cannot switch to a location that is no longer offered", () => {
    expect(reorderLocation(event, CAFE, ["cafe"])).toMatchObject({ mismatch: true, canSwitch: false });
  });
});

describe("addableLines", () => {
  it("keeps ok and price-changed lines, drops unavailable ones", () => {
    const lines = [
      reviewSavedLine(savedLatte({ key: "a" }), latte(), CAFE),
      reviewSavedLine(savedLatte({ key: "b" }), latte({ mediumPrice: 600 }), CAFE),
      reviewSavedLine(savedLatte({ key: "c" }), null, CAFE),
    ];
    expect(addableLines({ lines }).map((l) => l.key)).toEqual(["a", "b"]);
  });
});

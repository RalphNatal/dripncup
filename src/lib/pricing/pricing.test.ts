import { describe, expect, it } from "vitest";

import {
  calculateLinePrice,
  calculateUnitPrice,
  defaultSelection,
  describeSelection,
  pruneSelection,
  resolveSelection,
  selectionKey,
  startingPriceCents,
  validateSelection,
  visibleGroupIds,
  type LineSelection,
  type ModifierSelection,
  type PricingModifierGroup,
  type PricingProduct,
} from "./index";

// ---------------------------------------------------------------------------
// Fixtures: a latte, modelled on the seed data, and a shave ice.
// ---------------------------------------------------------------------------

const latte: PricingProduct = {
  id: "latte",
  name: "Latte",
  basePriceCents: 0,
  soldOut: false,
  sizes: [
    { id: "small", name: "Small", priceCents: 475, isDefault: false },
    { id: "medium", name: "Medium", priceCents: 575, isDefault: true },
    { id: "large", name: "Large", priceCents: 650, isDefault: false },
  ],
};

const group = (overrides: Partial<PricingModifierGroup> & Pick<PricingModifierGroup, "id" | "options">) =>
  ({
    name: overrides.id,
    selectionType: "single",
    required: false,
    minSelections: 0,
    maxSelections: null,
    chargePerQuantity: true,
    quantityUnit: null,
    visibleWhenOptionId: null,
    ...overrides,
  }) satisfies PricingModifierGroup;

const option = (id: string, overrides: Partial<PricingModifierGroup["options"][number]> = {}) => ({
  id,
  name: id,
  priceDeltaCents: 0,
  isDefault: false,
  maxQuantity: 1,
  soldOut: false,
  ...overrides,
});

const temperature = group({
  id: "temperature",
  name: "Hot or Iced",
  required: true,
  minSelections: 1,
  maxSelections: 1,
  options: [option("hot", { name: "Hot", isDefault: true }), option("iced", { name: "Iced" })],
});

const ice = group({
  id: "ice",
  name: "Ice",
  required: true,
  minSelections: 1,
  maxSelections: 1,
  visibleWhenOptionId: "iced",
  options: [option("light-ice", { name: "Light ice" }), option("regular-ice", { name: "Regular ice", isDefault: true })],
});

const milk = group({
  id: "milk",
  name: "Milk",
  required: true,
  minSelections: 1,
  maxSelections: 1,
  options: [
    option("whole", { name: "Whole milk", isDefault: true }),
    option("oat", { name: "Oat milk", priceDeltaCents: 80 }),
    option("macadamia", { name: "Macadamia milk", priceDeltaCents: 90, soldOut: true }),
  ],
});

const shots = group({
  id: "shots",
  name: "Espresso shots",
  selectionType: "multi",
  maxSelections: 1,
  chargePerQuantity: true,
  quantityUnit: "shot",
  options: [option("extra-shot", { name: "Extra espresso shot", priceDeltaCents: 100, maxQuantity: 4 })],
});

const syrups = group({
  id: "syrups",
  name: "Flavors & syrups",
  selectionType: "multi",
  maxSelections: 3,
  chargePerQuantity: false,
  quantityUnit: "pump",
  options: ["vanilla", "macadamia-syrup", "coconut", "lilikoi"].map((id) =>
    option(id, { name: id, priceDeltaCents: 75, maxQuantity: 6 }),
  ),
});

const latteGroups = [temperature, ice, milk, shots, syrups];

const shaveIce: PricingProduct = {
  id: "shave-ice",
  name: "Classic Shave Ice",
  basePriceCents: 0,
  soldOut: false,
  sizes: [
    { id: "regular", name: "Regular", priceCents: 550, isDefault: true },
    { id: "large-bowl", name: "Large", priceCents: 700, isDefault: false },
  ],
};

const flavors = group({
  id: "flavors",
  name: "Shave ice flavors",
  selectionType: "multi",
  required: true,
  minSelections: 1,
  maxSelections: 3,
  options: ["guava", "mango", "lilikoi-syrup", "strawberry"].map((id) => option(id)),
});

const cookie: PricingProduct = { id: "cookie", name: "Cookie", basePriceCents: 375, soldOut: false, sizes: [] };

/** Default latte selection with `changes` merged over the modifiers. */
function latteWith(changes: ModifierSelection = {}, sizeId: string | null = "medium"): LineSelection {
  const base = defaultSelection(latte, latteGroups);
  return { sizeId, modifiers: { ...base.modifiers, ...changes } };
}

function priceOf(product: PricingProduct, groups: PricingModifierGroup[], selection: LineSelection, qty = 1) {
  const size = product.sizes.find((s) => s.id === selection.sizeId) ?? null;
  return calculateLinePrice(product, size, resolveSelection(groups, selection.modifiers), qty);
}

const codes = (selection: LineSelection, product = latte, groups = latteGroups) =>
  validateSelection(product, groups, selection).map((e) => e.code);

// ---------------------------------------------------------------------------

describe("default selection", () => {
  it("preselects the default size and every default option", () => {
    const selection = defaultSelection(latte, latteGroups);
    expect(selection.sizeId).toBe("medium");
    expect(selection.modifiers).toEqual({
      temperature: { hot: 1 },
      ice: { "regular-ice": 1 },
      milk: { whole: 1 },
    });
  });

  it("is valid as-is and prices at the default size", () => {
    const selection = defaultSelection(latte, latteGroups);
    expect(validateSelection(latte, latteGroups, selection)).toEqual([]);
    expect(priceOf(latte, latteGroups, selection)).toBe(575);
  });

  it("falls back to the first size when none is marked default", () => {
    const noDefault = { ...latte, sizes: latte.sizes.map((s) => ({ ...s, isDefault: false })) };
    expect(defaultSelection(noDefault, []).sizeId).toBe("small");
  });

  it("has no size for a single-price item", () => {
    expect(defaultSelection(cookie, []).sizeId).toBeNull();
  });

  it("leaves a sold-out default unselected rather than swapping in something else", () => {
    const wholeSoldOut = {
      ...milk,
      options: milk.options.map((o) => (o.id === "whole" ? { ...o, soldOut: true } : o)),
    };
    const selection = defaultSelection(latte, [wholeSoldOut]);
    expect(selection.modifiers.milk).toBeUndefined();
    expect(codes(selection, latte, [wholeSoldOut])).toEqual(["required"]);
  });
});

describe("required groups", () => {
  it("reports a required group with nothing chosen", () => {
    const selection = defaultSelection(shaveIce, [flavors]);
    const errors = validateSelection(shaveIce, [flavors], selection);
    expect(errors).toEqual([
      { code: "required", groupId: "flavors", message: "Shave ice flavors: choose at least one." },
    ]);
  });

  it("asks a required single-select group to choose one", () => {
    const [error] = validateSelection(latte, latteGroups, latteWith({ milk: {} }));
    expect(error).toMatchObject({ code: "required", groupId: "milk", message: "Milk: choose one." });
  });

  it("does not require an optional group", () => {
    expect(codes(latteWith({ syrups: {} }))).toEqual([]);
  });

  it("requires a size when the product has sizes", () => {
    expect(codes(latteWith({}, null))).toEqual(["size_required"]);
  });
});

describe("too few and too many", () => {
  it("rejects fewer than the minimum once something is chosen", () => {
    const atLeastTwo = { ...flavors, minSelections: 2 };
    const errors = validateSelection(shaveIce, [atLeastTwo], {
      sizeId: "regular",
      modifiers: { flavors: { guava: 1 } },
    });
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      ["too_few", "Shave ice flavors: choose at least 2."],
    ]);
  });

  it("rejects more than the maximum", () => {
    const four = latteWith({ syrups: { vanilla: 1, "macadamia-syrup": 1, coconut: 1, lilikoi: 1 } });
    expect(validateSelection(latte, latteGroups, four)).toEqual([
      { code: "too_many", groupId: "syrups", message: "Flavors & syrups: choose up to 3." },
    ]);
  });

  it("accepts exactly the maximum", () => {
    expect(codes(latteWith({ syrups: { vanilla: 1, coconut: 1, lilikoi: 1 } }))).toEqual([]);
  });

  it("allows only one option in a single-select group", () => {
    const [error] = validateSelection(latte, latteGroups, latteWith({ milk: { whole: 1, oat: 1 } }));
    expect(error).toMatchObject({ code: "too_many", message: "Milk: choose only one." });
  });

  it("treats a zero quantity as not chosen", () => {
    expect(codes(latteWith({ milk: { whole: 0, oat: 1 } }))).toEqual([]);
  });
});

describe("pump counts", () => {
  it("accepts pumps up to the option's limit", () => {
    expect(codes(latteWith({ syrups: { vanilla: 6 } }))).toEqual([]);
  });

  it("rejects more pumps than allowed, naming the unit", () => {
    const [error] = validateSelection(latte, latteGroups, latteWith({ syrups: { vanilla: 7 } }));
    expect(error).toMatchObject({
      code: "quantity_out_of_range",
      groupId: "syrups",
      message: "vanilla: choose up to 6 pumps.",
    });
  });

  it("rejects fractional or negative pump counts", () => {
    expect(codes(latteWith({ syrups: { vanilla: 1.5 } }))).toEqual(["quantity_out_of_range"]);
    expect(codes(latteWith({ syrups: { vanilla: -1 } }))).toEqual(["quantity_out_of_range"]);
  });

  it("charges a flavour once however many pumps when the group says so", () => {
    expect(priceOf(latte, latteGroups, latteWith({ syrups: { vanilla: 1 } }))).toBe(575 + 75);
    expect(priceOf(latte, latteGroups, latteWith({ syrups: { vanilla: 4 } }))).toBe(575 + 75);
    expect(priceOf(latte, latteGroups, latteWith({ syrups: { vanilla: 2, coconut: 3 } }))).toBe(575 + 150);
  });

  it("charges per pump when the group charges per unit", () => {
    const perPump = latteGroups.map((g) => (g.id === "syrups" ? { ...g, chargePerQuantity: true } : g));
    expect(priceOf(latte, perPump, latteWith({ syrups: { vanilla: 3 } }))).toBe(575 + 225);
  });
});

describe("extra shots", () => {
  it("charges each extra shot", () => {
    expect(priceOf(latte, latteGroups, latteWith({ shots: { "extra-shot": 1 } }))).toBe(675);
    expect(priceOf(latte, latteGroups, latteWith({ shots: { "extra-shot": 2 } }))).toBe(775);
    expect(priceOf(latte, latteGroups, latteWith({ shots: { "extra-shot": 4 } }))).toBe(975);
  });

  it("stops at the maximum", () => {
    const [error] = validateSelection(latte, latteGroups, latteWith({ shots: { "extra-shot": 5 } }));
    expect(error).toMatchObject({ code: "quantity_out_of_range", message: "Extra espresso shot: choose up to 4 shots." });
  });

  it("treats zero extra shots as none", () => {
    expect(codes(latteWith({ shots: { "extra-shot": 0 } }))).toEqual([]);
    expect(priceOf(latte, latteGroups, latteWith({ shots: { "extra-shot": 0 } }))).toBe(575);
  });
});

describe("per-size pricing", () => {
  it("uses each size's own absolute price", () => {
    expect(priceOf(latte, latteGroups, latteWith({}, "small"))).toBe(475);
    expect(priceOf(latte, latteGroups, latteWith({}, "medium"))).toBe(575);
    expect(priceOf(latte, latteGroups, latteWith({}, "large"))).toBe(650);
  });

  it("adds modifiers on top of the chosen size", () => {
    const selection = latteWith({ milk: { oat: 1 }, shots: { "extra-shot": 1 } }, "large");
    expect(priceOf(latte, latteGroups, selection)).toBe(650 + 80 + 100);
  });

  it("uses the base price for items without sizes", () => {
    expect(priceOf(cookie, [], { sizeId: null, modifiers: {} })).toBe(375);
  });

  it("rejects a size that is not on the product", () => {
    expect(codes(latteWith({}, "venti"))).toEqual(["unknown_size"]);
    expect(codes({ sizeId: "medium", modifiers: {} }, cookie, [])).toEqual(["unknown_size"]);
  });

  it("starts the menu card at the cheapest size", () => {
    expect(startingPriceCents(latte)).toBe(475);
    expect(startingPriceCents(cookie)).toBe(375);
  });
});

describe("sold-out options and products", () => {
  it("refuses a sold-out option", () => {
    const [error] = validateSelection(latte, latteGroups, latteWith({ milk: { macadamia: 1 } }));
    expect(error).toMatchObject({
      code: "option_sold_out",
      groupId: "milk",
      optionId: "macadamia",
      message: "Macadamia milk is sold out. Choose something else.",
    });
  });

  it("refuses a sold-out product", () => {
    const soldOut = { ...latte, soldOut: true };
    expect(codes(defaultSelection(soldOut, latteGroups), soldOut)).toEqual(["product_sold_out"]);
  });
});

describe("quantity greater than 1", () => {
  it("multiplies the customised unit price", () => {
    const selection = latteWith({ milk: { oat: 1 }, syrups: { vanilla: 2 } }, "large");
    const unit = 650 + 80 + 75;
    expect(priceOf(latte, latteGroups, selection, 1)).toBe(unit);
    expect(priceOf(latte, latteGroups, selection, 3)).toBe(unit * 3);
    expect(priceOf(latte, latteGroups, selection, 99)).toBe(unit * 99);
  });

  it("refuses quantities the order table would reject", () => {
    for (const qty of [0, -1, 1.5, 100, Number.NaN]) {
      expect(() => calculateLinePrice(latte, latte.sizes[1], [], qty)).toThrow(RangeError);
    }
  });
});

describe("conditional groups", () => {
  it("hides Ice while the drink is hot", () => {
    const hot = latteWith();
    expect(visibleGroupIds(latteGroups, hot.modifiers).has("ice")).toBe(false);
  });

  it("shows Ice once Iced is chosen, with its default ready", () => {
    const iced = latteWith({ temperature: { iced: 1 } });
    expect(visibleGroupIds(latteGroups, iced.modifiers).has("ice")).toBe(true);
    expect(codes(iced)).toEqual([]);
  });

  it("enforces a conditional group's rules only while it is showing", () => {
    expect(codes(latteWith({ ice: {} }))).toEqual([]);
    expect(codes(latteWith({ temperature: { iced: 1 }, ice: {} }))).toEqual(["required"]);
  });

  it("neither charges nor keeps choices in a hidden group", () => {
    const pricedIce = latteGroups.map((g) =>
      g.id === "ice" ? { ...g, options: g.options.map((o) => ({ ...o, priceDeltaCents: 50 })) } : g,
    );
    const hot = latteWith();
    expect(priceOf(latte, pricedIce, hot)).toBe(575);
    expect(resolveSelection(pricedIce, hot.modifiers).map((m) => m.groupId)).not.toContain("ice");
    expect(pruneSelection(pricedIce, hot.modifiers)).toEqual({ temperature: { hot: 1 }, milk: { whole: 1 } });

    const iced = latteWith({ temperature: { iced: 1 } });
    expect(priceOf(latte, pricedIce, iced)).toBe(625);
  });

  it("shows a group whose controlling option is not on the product", () => {
    const orphan = group({ id: "orphan", visibleWhenOptionId: "not-on-this-product", options: [option("x")] });
    expect(visibleGroupIds([orphan], {}).has("orphan")).toBe(true);
  });

  it("follows chained conditions", () => {
    const whip = group({ id: "whip", visibleWhenOptionId: "light-ice", options: [option("extra-whip")] });
    const groups = [...latteGroups, whip];
    expect(visibleGroupIds(groups, latteWith({ ice: { "light-ice": 1 } }).modifiers).has("whip")).toBe(false);
    const iced = latteWith({ temperature: { iced: 1 }, ice: { "light-ice": 1 } });
    expect(visibleGroupIds(groups, iced.modifiers).has("whip")).toBe(true);
  });
});

describe("tampering and edge cases", () => {
  it("rejects options and groups that are not on the product", () => {
    expect(codes(latteWith({ milk: { "goat-milk": 1 } }))).toContain("unknown_option");
    expect(codes(latteWith({ "secret-menu": { anything: 1 } }))).toContain("unknown_option");
  });

  it("never prices a line below zero", () => {
    const byoc = group({ id: "byoc", options: [option("own-cup", { priceDeltaCents: -1000 })] });
    expect(calculateUnitPrice(cookie, null, resolveSelection([byoc], { byoc: { "own-cup": 1 } }))).toBe(0);
  });

  it("limits special instructions to 100 characters", () => {
    expect(codes({ ...latteWith(), specialInstructions: "x".repeat(100) })).toEqual([]);
    expect(codes({ ...latteWith(), specialInstructions: "x".repeat(101) })).toEqual(["instructions_too_long"]);
  });

  it("takes prices from the catalogue, not the selection", () => {
    const resolved = resolveSelection(latteGroups, { milk: { oat: 1 } });
    expect(resolved).toEqual([
      {
        groupId: "milk",
        groupName: "Milk",
        optionId: "oat",
        optionName: "Oat milk",
        quantity: 1,
        priceDeltaCents: 80,
        chargePerQuantity: true,
        quantityUnit: null,
      },
    ]);
  });
});

describe("describing a line", () => {
  it("reads naturally for sizes, pumps and repeated options", () => {
    const selection = latteWith({
      temperature: { iced: 1 },
      milk: { oat: 1 },
      shots: { "extra-shot": 2 },
      syrups: { vanilla: 3 },
    });
    expect(describeSelection("Large", resolveSelection(latteGroups, selection.modifiers))).toEqual([
      "Large",
      "Iced",
      "Regular ice",
      "Oat milk",
      "Extra espresso shot (2 shots)",
      "vanilla (3 pumps)",
    ]);
  });

  it("keys identical selections the same regardless of order", () => {
    expect(selectionKey({ b: { y: 1, x: 2 }, a: { z: 1 } })).toBe(selectionKey({ a: { z: 1 }, b: { x: 2, y: 1 } }));
    expect(selectionKey({ a: { z: 1 } })).not.toBe(selectionKey({ a: { z: 2 } }));
    expect(selectionKey({ a: { z: 0 } })).toBe(selectionKey({}));
  });
});

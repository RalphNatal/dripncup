import { describe, expect, it } from "vitest";

import { calculateUnitPrice, defaultSelection, resolveSelection, visibleGroupIds } from "@/lib/pricing";

import {
  parseDollars,
  previewDetail,
  productDraftToRpc,
  validateGroupDraft,
  validateProductDraft,
  type AdminGroup,
  type GroupDraft,
  type ProductDraft,
} from "./rules";

const option = (id: string, name: string, over: Partial<AdminGroup["options"][number]> = {}) => ({
  id, name, description: null, priceDeltaCents: 0, isDefault: false, maxQuantity: 1, allergens: [], isActive: true, archived: false, ...over,
});

const TEMP: AdminGroup = {
  id: "11111111-1111-4111-8111-111111111111", slug: "temperature", name: "Hot or Iced", description: null, selectionType: "single",
  isRequired: true, minSelections: 1, maxSelections: 1, maxQuantityPerOption: 1, quantityUnit: null, chargePerQuantity: true,
  isActive: true, archived: false,
  options: [option("a1111111-1111-4111-8111-111111111111", "Hot", { isDefault: true }), option("a2222222-2222-4222-8222-222222222222", "Iced")],
};
const ICE: AdminGroup = {
  ...TEMP, id: "22222222-2222-4222-8222-222222222222", slug: "ice", name: "Ice",
  options: [option("b1111111-1111-4111-8111-111111111111", "Light"), option("b2222222-2222-4222-8222-222222222222", "Regular", { isDefault: true })],
};
const SYRUPS: AdminGroup = {
  ...TEMP, id: "33333333-3333-4333-8333-333333333333", slug: "syrups", name: "Syrups", selectionType: "multi", isRequired: false,
  minSelections: 0, maxSelections: 3, maxQuantityPerOption: 6, quantityUnit: "pump", chargePerQuantity: false,
  options: [option("c1111111-1111-4111-8111-111111111111", "Vanilla", { priceDeltaCents: 75, maxQuantity: 6 })],
};
const NO_DEFAULT: AdminGroup = { ...TEMP, id: "44444444-4444-4444-8444-444444444444", name: "Strength", options: [option("d1", "Mild"), option("d2", "Bold")] };
const GROUPS = [TEMP, ICE, SYRUPS, NO_DEFAULT];

const draft = (over: Partial<ProductDraft> = {}): ProductDraft => ({
  id: null, name: "Iced Tea", slug: "", description: "", categoryId: null, imagePath: null, basePrice: "", calories: "",
  sizes: [
    { key: "s", id: null, name: "Small", price: "4.00", volumeOz: "12", isDefault: true },
    { key: "l", id: null, name: "Large", price: "5.25", volumeOz: "", isDefault: false },
  ],
  groups: [
    { groupId: TEMP.id, visibleWhenOptionId: null },
    { groupId: ICE.id, visibleWhenOptionId: TEMP.options[1].id },
    { groupId: SYRUPS.id, visibleWhenOptionId: null },
  ],
  allergens: [], dietaryTags: ["vegan"], cateringEligible: false, isActive: true, availableFrom: null, availableUntil: null,
  ...over,
});

describe("parseDollars", () => {
  it("reads dollar amounts the editor accepts", () => {
    expect(parseDollars("5")).toBe(500);
    expect(parseDollars("5.5")).toBe(550);
    expect(parseDollars("$5.25")).toBe(525);
    expect(parseDollars("5.255")).toBeNull();
    expect(parseDollars("-0.50")).toBeNull();
    expect(parseDollars("-0.50", { allowNegative: true })).toBe(-50);
  });
});

describe("validateProductDraft", () => {
  it("accepts a product with sizes and a conditional group", () => {
    expect(validateProductDraft(draft(), GROUPS)).toEqual({});
  });

  it("needs a price or sizes, exactly one default size, and distinct sizes", () => {
    expect(validateProductDraft(draft({ sizes: [] }), GROUPS)).toEqual({ basePrice: "Enter a price like 4.50 (up to $1,000), or add sizes." });
    expect(validateProductDraft(draft({ sizes: draft().sizes.map((s) => ({ ...s, isDefault: false })) }), GROUPS)).toEqual({
      sizes: "Pick exactly one default size.",
    });
    const dup = draft({ sizes: draft().sizes.map((s) => ({ ...s, name: "Small" })) });
    expect(validateProductDraft(dup, GROUPS)["sizes.1.name"]).toBe("Each size needs a different name.");
  });

  it("checks 'Only show when' names an option from another group on the product", () => {
    const own = draft({ groups: [{ groupId: TEMP.id, visibleWhenOptionId: null }, { groupId: ICE.id, visibleWhenOptionId: ICE.options[0].id }] });
    expect(validateProductDraft(own, GROUPS)["groups.1.visibleWhen"]).toBe("Pick an option from another group on this product.");
    const missing = draft({ groups: [{ groupId: ICE.id, visibleWhenOptionId: TEMP.options[1].id }] });
    expect(validateProductDraft(missing, GROUPS)["groups.0.visibleWhen"]).toBe("Pick an option from another group on this product.");
  });

  it("refuses 'Only show when' rules that depend on each other in a loop", () => {
    const loop = draft({
      groups: [
        { groupId: TEMP.id, visibleWhenOptionId: ICE.options[0].id },
        { groupId: ICE.id, visibleWhenOptionId: TEMP.options[1].id },
      ],
    });
    const errors = validateProductDraft(loop, GROUPS);
    expect(errors["groups.0.visibleWhen"]).toMatch(/in a loop/);
    expect(errors["groups.1.visibleWhen"]).toMatch(/in a loop/);
  });

  it("refuses a required single-choice group without a default", () => {
    expect(validateProductDraft(draft({ groups: [{ groupId: NO_DEFAULT.id, visibleWhenOptionId: null }] }), GROUPS)["groups.0"]).toMatch(/needs a default option/);
  });

  it("makes the web address from the name", () => {
    expect(productDraftToRpc(draft({ name: "Lilikoʻi Lemonade!" })).p_product.slug).toBe("lilikoi-lemonade");
    expect(productDraftToRpc(draft()).p_sizes).toEqual([
      { id: null, name: "Small", price_cents: 400, volume_oz: 12, is_default: true },
      { id: null, name: "Large", price_cents: 525, volume_oz: null, is_default: false },
    ]);
  });
});

describe("validateGroupDraft", () => {
  const group = (over: Partial<GroupDraft> = {}): GroupDraft => ({
    id: null, name: "Syrups", slug: "", description: "", selectionType: "multi", isRequired: false, minSelections: "0",
    maxSelections: "3", maxQuantityPerOption: "6", quantityUnit: "pump", chargePerQuantity: false, isActive: true,
    options: [{ key: "v", id: null, name: "Vanilla", description: "", price: "0.75", isDefault: false, maxQuantity: "6", allergens: [] }],
    ...over,
  });

  it("accepts a valid group", () => {
    expect(validateGroupDraft(group())).toEqual({});
  });

  it("checks min against max, and required against min", () => {
    expect(validateGroupDraft(group({ isRequired: true, minSelections: "4", maxSelections: "3" })).maxSelections).toBe(
      "The most choices can't be fewer than the least.",
    );
    expect(validateGroupDraft(group({ isRequired: true, minSelections: "0" })).minSelections).toBe("A required group needs at least 1 choice.");
    expect(validateGroupDraft(group({ minSelections: "2" })).minSelections).toMatch(/Only a required group has a minimum/);
  });

  it("needs a default for a required single-choice group", () => {
    expect(validateGroupDraft(group({ selectionType: "single", isRequired: true })).options).toMatch(/needs a default option/);
  });

  it("keeps option units within the group's", () => {
    const tooMany = group({ options: [{ ...group().options[0], maxQuantity: "9" }] });
    expect(validateGroupDraft(tooMany)["options.0.maxQuantity"]).toBe("From 1 to 6.");
  });
});

describe("previewDetail", () => {
  it("is the customer's product sheet: default size, hidden conditional group, live prices", () => {
    const detail = previewDetail(draft(), GROUPS, { id: "cat", name: "Tea", slug: "tea" }, "http://127.0.0.1:54321")!;
    expect(detail.product.name).toBe("Iced Tea");
    expect(detail.product.categoryName).toBe("Tea");
    expect(detail.groups.map((g) => g.name)).toEqual(["Hot or Iced", "Ice", "Syrups"]);

    const start = defaultSelection(detail.product, detail.groups);
    expect(start.sizeId).toBe(detail.product.sizes[0].id);
    // Hot by default, so Ice is hidden until Iced is picked.
    expect(visibleGroupIds(detail.groups, start.modifiers).has(ICE.id)).toBe(false);
    const iced = { ...start.modifiers, [TEMP.id]: { [TEMP.options[1].id]: 1 } };
    expect(visibleGroupIds(detail.groups, iced).has(ICE.id)).toBe(true);

    // Large with 3 pumps of vanilla: $5.25 + $0.75 once (charged per flavour).
    const large = detail.product.sizes[1];
    const withSyrup = { ...iced, [SYRUPS.id]: { [SYRUPS.options[0].id]: 3 } };
    expect(calculateUnitPrice(detail.product, large, resolveSelection(detail.groups, withSyrup))).toBe(600);
  });

  it("leaves out switched-off groups and archived options, as customers would", () => {
    const off = { ...SYRUPS, isActive: false };
    const detail = previewDetail(draft(), [TEMP, { ...ICE, options: [ICE.options[0], { ...ICE.options[1], archived: true }] }, off], null, "")!;
    expect(detail.groups.map((g) => g.name)).toEqual(["Hot or Iced", "Ice"]);
    expect(detail.groups[1].options.map((o) => o.name)).toEqual(["Light"]);
  });

  it("is empty until the product has a name", () => {
    expect(previewDetail(draft({ name: " " }), GROUPS, null, "")).toBeNull();
  });
});

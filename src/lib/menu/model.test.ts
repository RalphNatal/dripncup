import { describe, expect, it } from "vitest";

import { defaultSelection, validateSelection } from "@/lib/pricing";

import type { CatalogData } from "./catalog";
import { buildMenu, buildProductDetail, soldOutFromOverrides, type MenuContext } from "./model";

const SUPABASE = "http://127.0.0.1:54321";
const NOW = new Date("2026-09-24T10:00:00-10:00");

function catalog(): CatalogData {
  return {
    categories: [
      { id: "coffee", name: "Coffee & Espresso", slug: "coffee-espresso", description: null, sort_order: 0 },
      { id: "snacks", name: "Food & Snacks", slug: "food-snacks", description: "Bites", sort_order: 10 },
    ],
    products: [
      {
        id: "latte",
        category_id: "coffee",
        name: "Latte",
        slug: "latte",
        description: "Double shot",
        image_url: "latte.webp",
        base_price_cents: 0,
        allergens: ["dairy"],
        dietary_tags: ["contains_caffeine"],
        calories: null,
        sort_order: 0,
      },
      {
        id: "cookie",
        category_id: "snacks",
        name: "Cookie",
        slug: "cookie",
        description: null,
        image_url: null,
        base_price_cents: 375,
        allergens: [],
        dietary_tags: [],
        calories: 220,
        sort_order: 0,
      },
      {
        id: "orphan",
        category_id: "retired-category",
        name: "Old drink",
        slug: "old-drink",
        description: null,
        image_url: null,
        base_price_cents: 100,
        allergens: [],
        dietary_tags: [],
        calories: null,
        sort_order: 0,
      },
      {
        id: "loose",
        category_id: null,
        name: "Mystery bag",
        slug: "mystery-bag",
        description: null,
        image_url: "https://cdn.example.test/bag.png",
        base_price_cents: 500,
        allergens: [],
        dietary_tags: [],
        calories: null,
        sort_order: 0,
      },
    ],
    sizes: [
      { id: "m", product_id: "latte", name: "Medium", price_cents: 575, volume_oz: 16, is_default: true, sort_order: 10 },
      { id: "s", product_id: "latte", name: "Small", price_cents: 475, volume_oz: 12, is_default: false, sort_order: 0 },
    ],
    groups: [
      {
        id: "milk",
        name: "Milk",
        description: null,
        selection_type: "single",
        is_required: true,
        min_selections: 1,
        max_selections: 1,
        max_quantity_per_option: 1,
        quantity_unit: null,
        charge_per_quantity: true,
      },
      {
        id: "syrups",
        name: "Syrups",
        description: null,
        selection_type: "multi",
        is_required: false,
        min_selections: 0,
        max_selections: 3,
        max_quantity_per_option: 6,
        quantity_unit: "pump",
        charge_per_quantity: false,
      },
      {
        id: "empty",
        name: "Nothing active",
        description: null,
        selection_type: "multi",
        is_required: false,
        min_selections: 0,
        max_selections: null,
        max_quantity_per_option: 1,
        quantity_unit: null,
        charge_per_quantity: true,
      },
    ],
    options: [
      { id: "whole", modifier_group_id: "milk", name: "Whole", price_delta_cents: 0, is_default: true, max_quantity: 1, allergens: ["dairy"], sort_order: 0 },
      { id: "oat", modifier_group_id: "milk", name: "Oat", price_delta_cents: 80, is_default: false, max_quantity: 1, allergens: [], sort_order: 10 },
      { id: "vanilla", modifier_group_id: "syrups", name: "Vanilla", price_delta_cents: 75, is_default: false, max_quantity: 10, allergens: [], sort_order: 0 },
    ],
    links: [
      {
        product_id: "latte",
        modifier_group_id: "syrups",
        sort_order: 10,
        override_is_required: true,
        override_min_selections: null,
        override_max_selections: 2,
        visible_when_option_id: null,
        created_at: "",
      },
      {
        product_id: "latte",
        modifier_group_id: "milk",
        sort_order: 0,
        override_is_required: null,
        override_min_selections: null,
        override_max_selections: null,
        visible_when_option_id: null,
        created_at: "",
      },
      {
        product_id: "latte",
        modifier_group_id: "empty",
        sort_order: 20,
        override_is_required: null,
        override_min_selections: null,
        override_max_selections: null,
        visible_when_option_id: null,
        created_at: "",
      },
    ],
    collections: [
      {
        id: "summer",
        name: "Summer Sunset",
        slug: "summer-sunset",
        description: null,
        banner_image_url: null,
        accent_color: "#E0409B",
        starts_at: "2026-09-01T00:00:00Z",
        ends_at: "2026-10-01T00:00:00Z",
        sort_order: 0,
      },
    ],
    collectionProducts: [
      { collection_id: "summer", product_id: "cookie", sort_order: 0 },
      { collection_id: "summer", product_id: "latte", sort_order: 10 },
    ],
    eventMenuItems: [{ location_id: "popup", product_id: "cookie", sort_order: 0 }],
  };
}

const cafeCtx: MenuContext = {
  location: { id: "cafe", type: "cafe" },
  soldOut: { productIds: [], optionIds: [] },
  now: NOW,
  supabaseUrl: SUPABASE,
};

describe("buildMenu", () => {
  it("groups products by category in order, with a From price at the cheapest size", () => {
    const menu = buildMenu(catalog(), cafeCtx);
    expect(menu.sections.map((s) => [s.slug, s.products.map((p) => p.slug)])).toEqual([
      ["coffee-espresso", ["latte"]],
      ["food-snacks", ["cookie"]],
      ["more", ["mystery-bag"]],
    ]);
    const latte = menu.sections[0].products[0];
    expect(latte.fromPriceCents).toBe(475);
    expect(menu.sections[1].products[0].fromPriceCents).toBe(375);
  });

  it("hides products whose category has been switched off", () => {
    const slugs = buildMenu(catalog(), cafeCtx).sections.flatMap((s) => s.products.map((p) => p.slug));
    expect(slugs).not.toContain("old-drink");
  });

  it("builds Storage URLs from paths, and ignores images hosted anywhere else", () => {
    const menu = buildMenu(catalog(), cafeCtx);
    expect(menu.sections[0].products[0].imageUrl).toBe(
      `${SUPABASE}/storage/v1/object/public/product-images/latte.webp`,
    );
    expect(menu.sections[1].products[0].imageUrl).toBeNull();
    // Not this project's Storage: next/image would refuse it, so the placeholder shows.
    expect(menu.sections[2].products[0].imageUrl).toBeNull();
  });

  it("marks products sold out at this location", () => {
    const menu = buildMenu(catalog(), { ...cafeCtx, soldOut: { productIds: ["cookie"], optionIds: [] } });
    expect(menu.sections[1].products[0].soldOut).toBe(true);
    expect(menu.sections[0].products[0].soldOut).toBe(false);
  });

  it("shows only the event's own menu at a pop-up", () => {
    const menu = buildMenu(catalog(), { ...cafeCtx, location: { id: "popup", type: "event" } });
    expect(menu.sections.flatMap((s) => s.products.map((p) => p.slug))).toEqual(["cookie"]);
    expect(menu.menuPublished).toBe(true);
  });

  it("treats a pop-up with no menu rows as not published, not as everything", () => {
    const menu = buildMenu(catalog(), { ...cafeCtx, location: { id: "other-popup", type: "event" } });
    expect(menu.sections).toEqual([]);
    expect(menu.menuPublished).toBe(false);
  });

  it("shows the seasonal collection only inside its window", () => {
    expect(buildMenu(catalog(), cafeCtx).collection).toMatchObject({
      name: "Summer Sunset",
      accentColor: "#E0409B",
      products: [{ slug: "cookie" }, { slug: "latte" }],
    });
    expect(buildMenu(catalog(), { ...cafeCtx, now: new Date("2026-10-01T00:00:00Z") }).collection).toBeNull();
    expect(buildMenu(catalog(), { ...cafeCtx, now: new Date("2026-08-31T23:59:59Z") }).collection).toBeNull();
  });

  it("lists only collection products this location carries", () => {
    const menu = buildMenu(catalog(), { ...cafeCtx, location: { id: "popup", type: "event" } });
    expect(menu.collection?.products).toEqual([{ slug: "cookie", name: "Cookie" }]);
  });
});

describe("buildProductDetail", () => {
  it("returns null for an unknown or hidden product", () => {
    expect(buildProductDetail(catalog(), "nope", cafeCtx)).toBeNull();
    expect(buildProductDetail(catalog(), "old-drink", cafeCtx)).toBeNull();
  });

  it("orders groups by the product link and applies per-product overrides", () => {
    const detail = buildProductDetail(catalog(), "latte", cafeCtx)!;
    expect(detail.groups.map((g) => g.id)).toEqual(["milk", "syrups"]);

    const syrups = detail.groups[1];
    expect(syrups).toMatchObject({ required: true, minSelections: 1, maxSelections: 2, quantityUnit: "pump" });
    // Option allows 10, group caps at 6.
    expect(syrups.options[0].maxQuantity).toBe(6);
  });

  it("drops a group with no active options", () => {
    expect(buildProductDetail(catalog(), "latte", cafeCtx)!.groups.map((g) => g.id)).not.toContain("empty");
  });

  it("carries sold-out options for this location into the engine", () => {
    const detail = buildProductDetail(catalog(), "latte", { ...cafeCtx, soldOut: { productIds: [], optionIds: ["oat"] } })!;
    const errors = validateSelection(detail.product, detail.groups, {
      sizeId: "m",
      modifiers: { milk: { oat: 1 }, syrups: { vanilla: 1 } },
    });
    expect(errors.map((e) => e.code)).toEqual(["option_sold_out"]);
  });

  it("produces a default selection the engine accepts once required choices are made", () => {
    const detail = buildProductDetail(catalog(), "latte", cafeCtx)!;
    const selection = defaultSelection(detail.product, detail.groups);
    expect(selection.sizeId).toBe("m");
    expect(validateSelection(detail.product, detail.groups, selection).map((e) => e.code)).toEqual(["required"]);
  });

  it("flags a product the pop-up does not carry", () => {
    const popup = { ...cafeCtx, location: { id: "popup", type: "event" as const } };
    expect(buildProductDetail(catalog(), "latte", popup)!.onLocationMenu).toBe(false);
    expect(buildProductDetail(catalog(), "cookie", popup)!.onLocationMenu).toBe(true);
  });
});

describe("soldOutFromOverrides", () => {
  it("honours explicit back-in-stock rows and self-expiring sold-outs", () => {
    const soldOut = soldOutFromOverrides(
      [
        { product_id: "a", modifier_option_id: null, is_available: false, available_from: null },
        { product_id: "b", modifier_option_id: null, is_available: true, available_from: null },
        { product_id: "c", modifier_option_id: null, is_available: false, available_from: "2026-09-24T19:00:00Z" },
        { product_id: null, modifier_option_id: "oat", is_available: false, available_from: "2026-09-25T00:00:00Z" },
      ],
      new Date("2026-09-24T20:00:00Z"),
    );
    expect(soldOut).toEqual({ productIds: ["a"], optionIds: ["oat"] });
  });
});

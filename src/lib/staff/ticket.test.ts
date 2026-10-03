import { describe, expect, it } from "vitest";

import type { SnapshotModifier } from "@/lib/orders/detail";

import { buildRank, cupLabels, itemAllergens, ticketLines, type CatalogMeta } from "./ticket";
import type { StaffOrderItem } from "./queue";

const groups: CatalogMeta["groups"] = {
  t: { slug: "temperature", name: "Hot or Iced", sortOrder: 10 },
  m: { slug: "milk", name: "Milk", sortOrder: 20 },
  s: { slug: "espresso-shots", name: "Espresso shots", sortOrder: 30 },
  f: { slug: "syrups", name: "Flavors & syrups", sortOrder: 40 },
  w: { slug: "sweetness", name: "Sweetness", sortOrder: 50 },
  i: { slug: "ice-level", name: "Ice", sortOrder: 60 },
  p: { slug: "toppings", name: "Toppings", sortOrder: 70 },
  x: { slug: "signature-addons", name: "Make it special", sortOrder: 80 },
};

const mod = (group_id: string, option_name: string, extra: Partial<SnapshotModifier> = {}): SnapshotModifier => ({
  group_id,
  group_name: groups[group_id]?.name ?? group_id,
  option_id: `${group_id}-${option_name}`,
  option_name,
  quantity: 1,
  price_delta_cents: 0,
  ...extra,
});

describe("ticketLines", () => {
  it("lists selections in build order, whatever order they were chosen in", () => {
    const lines = ticketLines(
      [
        mod("p", "Whipped cream"),
        mod("i", "Light ice"),
        mod("w", "50%"),
        mod("f", "Vanilla", { quantity: 2, quantity_unit: "pump" }),
        mod("s", "Extra espresso shot", { quantity: 2, quantity_unit: "shot", charge_per_quantity: true }),
        mod("m", "Oat milk"),
        mod("t", "Iced"),
      ],
      groups,
    );
    expect(lines).toEqual([
      "Iced",
      "Oat milk",
      "Extra espresso shot (2 shots)",
      "Vanilla (2 pumps)",
      "50%",
      "Light ice",
      "Whipped cream",
    ]);
  });

  it("falls back to the snapshot's group name when the group has since been deleted", () => {
    const lines = ticketLines(
      [
        { group_name: "Ice", option_name: "No ice", quantity: 1 },
        { group_name: "Milk", option_name: "Soy milk", quantity: 1 },
      ],
      {},
    );
    expect(lines).toEqual(["Soy milk", "No ice"]);
  });

  it("puts unknown groups last", () => {
    const lines = ticketLines([mod("z", "Extra hot napkin"), mod("t", "Hot")], groups);
    expect(lines).toEqual(["Hot", "Extra hot napkin"]);
  });
});

describe("buildRank", () => {
  it("files shave-ice groups sensibly", () => {
    expect(buildRank({ slug: "shave-ice-flavors" })).toBe(3);
    expect(buildRank({ slug: "shave-ice-addons" })).toBe(6);
    expect(buildRank({ slug: "add-milk", name: "Add milk" })).toBe(1);
    expect(buildRank({ slug: "signature-addons" })).toBe(6);
  });
});

describe("itemAllergens", () => {
  const meta: CatalogMeta = {
    groups,
    productAllergens: { latte: ["dairy"] },
    optionAllergens: { "m-Oat milk": ["gluten"], "f-Macadamia": ["tree_nuts", "macadamia"] },
  };

  it("combines the product's allergens with the chosen options'", () => {
    const item = { productId: "latte", modifiers: [mod("m", "Oat milk"), mod("f", "Macadamia")] };
    expect(itemAllergens(item, meta)).toEqual(["dairy", "tree_nuts", "macadamia", "gluten"]);
  });

  it("is empty for a product with none", () => {
    expect(itemAllergens({ productId: "cold-brew", modifiers: [] }, meta)).toEqual([]);
  });
});

describe("cupLabels", () => {
  it("prints one label per drink, numbered across the order", () => {
    const item = (id: string, quantity: number): StaffOrderItem => ({
      id,
      productId: null,
      name: id,
      sizeName: null,
      quantity,
      modifiers: [],
      specialInstructions: null,
    });
    const labels = cupLabels([item("latte", 2), item("tea", 1)]);
    expect(labels.map((l) => `${l.item.name} ${l.index}/${l.total}`)).toEqual(["latte 1/3", "latte 2/3", "tea 3/3"]);
  });
});

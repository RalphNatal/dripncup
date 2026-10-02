import { describe, expect, it } from "vitest";

import {
  DUPLICATE_MESSAGE,
  FAVORITE_NAME_MAX,
  LIMIT_MESSAGE,
  defaultFavoriteName,
  favoriteErrorMessage,
  favoriteNameSchema,
  saveFavoriteSchema,
} from "./schemas";

const ID = "8e9d1c56-55a4-4d9e-9a63-3a6c1b3a2f10";

describe("favoriteNameSchema", () => {
  it("trims and accepts up to 40 characters", () => {
    expect(favoriteNameSchema.parse("  My usual  ")).toBe("My usual");
    expect(favoriteNameSchema.parse("x".repeat(FAVORITE_NAME_MAX))).toHaveLength(40);
  });

  it("requires a name", () => {
    expect(favoriteNameSchema.safeParse("").error?.issues[0].message).toBe("Give your favorite a name.");
    expect(favoriteNameSchema.safeParse("    ").success).toBe(false);
    expect(favoriteNameSchema.safeParse(undefined).success).toBe(false);
  });

  it("refuses 41 characters", () => {
    expect(favoriteNameSchema.safeParse("x".repeat(41)).error?.issues[0].message).toMatch(/40 characters/);
  });

  it("keeps ʻokina and kahakō intact", () => {
    expect(favoriteNameSchema.parse("Kakaʻako mōʻī latte")).toBe("Kakaʻako mōʻī latte");
  });
});

describe("defaultFavoriteName", () => {
  it("prefills with the product name, cut to fit", () => {
    expect(defaultFavoriteName("Passion-Orange-Guava Refresher")).toBe("Passion-Orange-Guava Refresher");
    expect(defaultFavoriteName(`${"Very long drink name ".repeat(3)}`)).toHaveLength(40);
    expect(defaultFavoriteName("A".repeat(39) + " B")).toBe("A".repeat(39));
  });
});

describe("saveFavoriteSchema", () => {
  it("accepts a product with its choices", () => {
    const parsed = saveFavoriteSchema.parse({ name: "My usual", productId: ID, sizeId: null, selection: { [ID]: { [ID]: 2 } } });
    expect(parsed.specialInstructions).toBe("");
  });

  it("refuses ids that are not UUIDs and silly quantities", () => {
    expect(saveFavoriteSchema.safeParse({ name: "x", productId: "latte", sizeId: null, selection: {} }).success).toBe(false);
    expect(saveFavoriteSchema.safeParse({ name: "x", productId: ID, sizeId: null, selection: { [ID]: { [ID]: 500 } } }).success).toBe(false);
  });
});

describe("favoriteErrorMessage", () => {
  it("explains the 50-favorite limit and duplicate names", () => {
    expect(favoriteErrorMessage("DC003")).toBe(LIMIT_MESSAGE);
    expect(LIMIT_MESSAGE).toMatch(/50 favorites/);
    expect(favoriteErrorMessage("23505")).toBe(DUPLICATE_MESSAGE);
    expect(favoriteErrorMessage(undefined)).toMatch(/try again/);
  });
});

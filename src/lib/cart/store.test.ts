import { beforeEach, describe, expect, it } from "vitest";

import { cartItemCount, useCartStore, type NewCartLine } from "./store";

const latte = (overrides: Partial<NewCartLine> = {}): NewCartLine => ({
  locationId: "cafe",
  productId: "latte",
  productSlug: "latte",
  productName: "Latte",
  sizeId: "medium",
  sizeName: "Medium",
  selection: { milk: { oat: 1 } },
  summary: ["Medium", "Oat milk"],
  specialInstructions: "",
  quantity: 1,
  unitPriceCents: 655,
  ...overrides,
});

beforeEach(() => {
  useCartStore.setState({ lines: [], locationId: null, needsRevalidation: false });
});

describe("cart store", () => {
  it("adds lines and counts items by quantity", () => {
    useCartStore.getState().addLine(latte());
    useCartStore.getState().addLine(latte({ productId: "cookie", selection: {}, quantity: 2 }));
    expect(cartItemCount(useCartStore.getState().lines)).toBe(3);
    expect(useCartStore.getState().locationId).toBe("cafe");
  });

  it("merges the same drink made the same way", () => {
    useCartStore.getState().addLine(latte());
    useCartStore.getState().addLine(latte({ quantity: 2 }));
    const { lines } = useCartStore.getState();
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(3);
  });

  it("keeps differently customised drinks apart", () => {
    useCartStore.getState().addLine(latte());
    useCartStore.getState().addLine(latte({ selection: { milk: { whole: 1 } } }));
    useCartStore.getState().addLine(latte({ specialInstructions: "Extra hot" }));
    expect(useCartStore.getState().lines).toHaveLength(3);
  });

  it("caps a merged line at 99", () => {
    useCartStore.getState().addLine(latte({ quantity: 98 }));
    useCartStore.getState().addLine(latte({ quantity: 5 }));
    expect(useCartStore.getState().lines[0].quantity).toBe(99);
  });

  it("keeps the cart but flags it when the location changes", () => {
    useCartStore.getState().addLine(latte());
    useCartStore.getState().syncLocation("popup");
    const state = useCartStore.getState();
    expect(state.lines).toHaveLength(1);
    expect(state.locationId).toBe("popup");
    expect(state.needsRevalidation).toBe(true);
  });

  it("does not flag an empty cart, or a return to the same location", () => {
    useCartStore.getState().syncLocation("popup");
    expect(useCartStore.getState().needsRevalidation).toBe(false);

    useCartStore.getState().addLine(latte({ locationId: "popup" }));
    useCartStore.getState().syncLocation("popup");
    expect(useCartStore.getState().needsRevalidation).toBe(false);
  });
});

"use client";

/**
 * The cart: a Zustand store persisted to localStorage.
 *
 * Each line keeps what the customer chose (ids and quantities), plus a
 * display snapshot (names, a summary, the unit price shown when added). The
 * snapshot is only for rendering. Checkout (Phase 4) re-validates and
 * re-prices every line on the server from the ids, so a stale or edited
 * price in storage changes nothing.
 *
 * The cart belongs to one location. Switching location keeps the lines but
 * marks the cart `needsRevalidation`; Phase 4's cart page re-checks them
 * against the new location's menu and availability.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { MAX_LINE_QUANTITY, selectionKey, type ModifierSelection } from "@/lib/pricing";

export interface CartLine {
  id: string;
  locationId: string;
  productId: string;
  productSlug: string;
  productName: string;
  sizeId: string | null;
  sizeName: string | null;
  /** Only groups that were showing, only chosen options (see pruneSelection). */
  selection: ModifierSelection;
  /** "Large", "Oat milk", "Vanilla (2 pumps)" -- display only. */
  summary: string[];
  specialInstructions: string;
  quantity: number;
  /** Display estimate at the time of adding. The server re-prices at checkout. */
  unitPriceCents: number;
  addedAt: string;
}

export type NewCartLine = Omit<CartLine, "id" | "addedAt">;

interface CartState {
  lines: CartLine[];
  /** The location the cart is being built for. */
  locationId: string | null;
  /** True after a location switch left lines from another location in the cart. */
  needsRevalidation: boolean;
  addLine: (line: NewCartLine) => void;
  syncLocation: (locationId: string) => void;
  clear: () => void;
}

/**
 * crypto.randomUUID only exists in secure contexts, and testing on a phone
 * over the LAN (http://192.168.x.x) is not one. A collision-resistant enough
 * fallback keeps the cart working there.
 */
function newLineId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Same product, made the same way, for the same location: one line, more of it. */
function sameDrink(a: NewCartLine, b: NewCartLine): boolean {
  return (
    a.locationId === b.locationId &&
    a.productId === b.productId &&
    a.sizeId === b.sizeId &&
    a.specialInstructions.trim() === b.specialInstructions.trim() &&
    selectionKey(a.selection) === selectionKey(b.selection)
  );
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      locationId: null,
      needsRevalidation: false,

      addLine: (line) =>
        set((state) => {
          const existing = state.lines.find((l) => sameDrink(l, line));
          const lines = existing
            ? state.lines.map((l) =>
                l === existing ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + line.quantity) } : l,
              )
            : [...state.lines, { ...line, id: newLineId(), addedAt: new Date().toISOString() }];
          return { lines, locationId: line.locationId };
        }),

      syncLocation: (locationId) =>
        set((state) => {
          if (state.locationId === locationId) return state;
          const hasOtherLocationLines = state.lines.some((l) => l.locationId !== locationId);
          return { locationId, needsRevalidation: hasOtherLocationLines };
        }),

      clear: () => set({ lines: [], needsRevalidation: false }),
    }),
    {
      name: "drincup-cart",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Rehydrated from CartSync after mount, so the server render and the
      // first client render agree (both start empty).
      skipHydration: true,
      partialize: ({ lines, locationId, needsRevalidation }) => ({ lines, locationId, needsRevalidation }),
    },
  ),
);

/** Items in the cart, counting quantities: two lattes are 2. */
export function cartItemCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

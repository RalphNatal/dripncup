"use client";

import { useSyncExternalStore } from "react";

import { useCartStore } from "./store";

/**
 * True once the persisted cart has been read from localStorage. Before that
 * the store is empty on purpose (see `skipHydration`), so the cart badge
 * waits for this rather than flashing "0".
 */
export function useCartHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useCartStore.persist.onFinishHydration(onChange),
    () => useCartStore.persist.hasHydrated(),
    () => false,
  );
}

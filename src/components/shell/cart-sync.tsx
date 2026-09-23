"use client";

import { useEffect } from "react";

import { useCartStore } from "@/lib/cart/store";

/**
 * Loads the saved cart after the first render (so server and client agree on
 * the initial HTML), then tells it which location is selected. A cart built
 * for another location is kept but flagged for re-validation.
 */
export function CartSync({ locationId }: { locationId: string | null }) {
  useEffect(() => {
    let cancelled = false;
    const sync = () => {
      if (!cancelled && locationId) useCartStore.getState().syncLocation(locationId);
    };

    if (useCartStore.persist.hasHydrated()) {
      sync();
    } else {
      void Promise.resolve(useCartStore.persist.rehydrate()).then(sync);
    }

    return () => {
      cancelled = true;
    };
  }, [locationId]);

  return null;
}

"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useCartHydrated } from "@/lib/cart/hooks";
import { cartItemCount, useCartStore } from "@/lib/cart/store";
import { cn } from "@/lib/utils";

/**
 * Header cart icon with a live item count. The badge gives a little bump
 * when something is added (decoration only: motion-safe, and the toast and
 * the label say it in words).
 */
export function CartButton() {
  const hydrated = useCartHydrated();
  const count = useCartStore((state) => cartItemCount(state.lines));
  const shown = hydrated ? count : 0;
  const label = shown === 0 ? "Cart, empty" : `Cart, ${shown} ${shown === 1 ? "item" : "items"}`;
  const [bumps, setBumps] = useState(0);

  useEffect(
    () =>
      useCartStore.subscribe((state, previous) => {
        if (cartItemCount(state.lines) > cartItemCount(previous.lines)) setBumps((n) => n + 1);
      }),
    [],
  );

  return (
    <Link
      href="/cart"
      aria-label={label}
      className="focus-ring relative inline-flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
    >
      <ShoppingBag className="size-6" aria-hidden="true" />
      <span
        key={bumps}
        aria-hidden="true"
        className={cn(
          "tabular absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-brand-magenta-deep px-1.5 text-center text-xs leading-5 font-bold text-white transition-transform",
          shown === 0 && "scale-0",
          bumps > 0 && "motion-safe:animate-cart-bump",
        )}
      >
        {shown > 99 ? "99+" : shown}
      </span>
    </Link>
  );
}

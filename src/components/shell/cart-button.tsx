"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";

import { useCartHydrated } from "@/lib/cart/hooks";
import { cartItemCount, useCartStore } from "@/lib/cart/store";
import { cn } from "@/lib/utils";

/** Header cart icon with a live item count. */
export function CartButton() {
  const hydrated = useCartHydrated();
  const count = useCartStore((state) => cartItemCount(state.lines));
  const shown = hydrated ? count : 0;
  const label = shown === 0 ? "Cart, empty" : `Cart, ${shown} ${shown === 1 ? "item" : "items"}`;

  return (
    <Link
      href="/cart"
      aria-label={label}
      className="focus-ring relative inline-flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
    >
      <ShoppingBag className="size-6" aria-hidden="true" />
      <span
        aria-hidden="true"
        className={cn(
          "tabular absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-brand-magenta-deep px-1.5 text-center text-xs leading-5 font-bold text-white transition-transform",
          shown === 0 && "scale-0",
        )}
      >
        {shown > 99 ? "99+" : shown}
      </span>
    </Link>
  );
}

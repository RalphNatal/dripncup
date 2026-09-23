"use client";

import { ShoppingBag } from "lucide-react";
import Link from "next/link";

import { useCartHydrated } from "@/lib/cart/hooks";
import { cartItemCount, useCartStore } from "@/lib/cart/store";

export function CartPlaceholder() {
  const hydrated = useCartHydrated();
  const count = useCartStore((s) => cartItemCount(s.lines));
  const needsRevalidation = useCartStore((s) => s.needsRevalidation);

  return (
    <div className="rounded-3xl border bg-card p-6 text-center">
      <ShoppingBag className="mx-auto size-10 text-brand-teal-deep" aria-hidden="true" />
      <p className="mt-3 text-lg font-bold" aria-live="polite">
        {!hydrated ? "Checking your cart…" : count === 0 ? "Your cart is empty" : `${count} ${count === 1 ? "item" : "items"} in your cart`}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">Checkout is on its way. Your items are saved on this device.</p>
      {hydrated && needsRevalidation ? (
        <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm">
          You changed pickup location, so we&apos;ll re-check these items at checkout.
        </p>
      ) : null}
      <Link
        href="/menu"
        className="focus-ring mt-5 inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
      >
        Keep browsing
      </Link>
    </div>
  );
}

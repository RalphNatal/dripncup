import type { Metadata } from "next";

import { CartView } from "@/components/cart/cart-view";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getStorefront } from "@/lib/locations/storefront";

export const metadata: Metadata = { title: "Cart" };

/** The cart. Guests can see it; checkout asks them to sign in first. */
export default async function CartPage() {
  const [{ selected }, profile] = await Promise.all([getStorefront(), getCurrentProfile()]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-extrabold">Your cart</h1>
      <div className="mt-4">
        {selected ? (
          <CartView
            signedIn={Boolean(profile)}
            location={{
              id: selected.id,
              name: selected.name,
              statusLabel: selected.status.label,
              statusKind: selected.status.kind,
            }}
          />
        ) : (
          <p className="text-muted-foreground">Ordering opens soon.</p>
        )}
      </div>
    </div>
  );
}

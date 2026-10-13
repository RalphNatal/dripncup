import { MapPin } from "lucide-react";
import type { Metadata } from "next";

import { CartView } from "@/components/cart/cart-view";
import { StatusDot } from "@/components/locations/status-dot";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getStorefront } from "@/lib/locations/storefront";

export const metadata: Metadata = { title: "Cart", robots: { index: false, follow: false } };

/**
 * The cart. Guests can see it; checkout asks them to sign in first. Where
 * the order will be picked up is known on the server, so it shows at once;
 * the lines come from this device's saved cart, re-checked by CartView.
 */
export default async function CartPage() {
  const [{ selected }, profile] = await Promise.all([getStorefront(), getCurrentProfile()]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-extrabold">Your cart</h1>
      {selected ? (
        <>
          <section aria-labelledby="cart-pickup" className="mt-4 flex gap-3 rounded-2xl border bg-card px-4 py-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <h2 id="cart-pickup" className="font-sans text-base font-semibold tracking-normal">
                Pickup at {selected.name}
              </h2>
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <StatusDot kind={selected.status.kind} />
                {selected.status.label}
                {selected.type === "event" ? ` · ${selected.todaysHours.hours}` : ` · Today: ${selected.todaysHours.hours}`}
              </p>
              {selected.pickupInstructions ? <p className="mt-1">{selected.pickupInstructions}</p> : null}
            </div>
          </section>
          <div className="mt-4">
            <CartView
              signedIn={Boolean(profile)}
              location={{
                id: selected.id,
                name: selected.name,
                statusLabel: selected.status.label,
                statusKind: selected.status.kind,
              }}
            />
          </div>
        </>
      ) : (
        <p className="mt-4 text-muted-foreground">Ordering opens soon.</p>
      )}
    </div>
  );
}

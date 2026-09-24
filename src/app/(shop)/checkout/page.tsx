import type { Metadata } from "next";

import { CheckoutView } from "@/components/checkout/checkout-view";
import { requireProfile } from "@/lib/auth/dal";
import { getCheckoutSettings } from "@/lib/checkout/settings";
import { clientEnv } from "@/lib/env";
import { getStorefront } from "@/lib/locations/storefront";

export const metadata: Metadata = { title: "Checkout" };

/** Signed-in customers only; guests are sent to sign in and come back here. */
export default async function CheckoutPage() {
  const profile = await requireProfile("/checkout");
  const [{ selected }, settings] = await Promise.all([getStorefront(), getCheckoutSettings()]);
  const publishableKey = clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-3xl font-extrabold">Checkout</h1>
      <div className="mt-4">
        {!selected ? (
          <p className="text-muted-foreground">Ordering opens soon.</p>
        ) : !publishableKey ? (
          // A deployment mistake, not something the customer can fix.
          <p role="alert" className="rounded-2xl border border-destructive/40 p-4 text-sm">
            Card payments aren&apos;t set up yet. Please order at the counter.
          </p>
        ) : (
          <CheckoutView
            publishableKey={publishableKey}
            defaultCupName={profile.first_name ?? profile.full_name?.split(/\s+/)[0] ?? ""}
            tipPresets={[...settings.tipPolicy.presetPercents]}
            defaultTipPercent={settings.defaultTipPercent}
            location={{
              id: selected.id,
              name: selected.name,
              pickupInstructions: selected.pickupInstructions,
            }}
          />
        )}
      </div>
    </div>
  );
}

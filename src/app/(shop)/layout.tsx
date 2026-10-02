import type { ReactNode } from "react";

import { AppHeader } from "@/components/shell/app-header";
import { CartSync } from "@/components/shell/cart-sync";
import { BottomTabs } from "@/components/shell/nav";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getStorefront } from "@/lib/locations/storefront";

/**
 * The customer app shell: header with the pickup location and cart, the page,
 * and the bottom tab bar on phones. Everything a customer sees lives here;
 * /staff, /admin and the sign-in pages have their own frames.
 */
export default async function ShopLayout({ children }: { children: ReactNode }) {
  const [storefront, profile] = await Promise.all([getStorefront(), getCurrentProfile()]);
  // Drives the live "order in progress" dot on the Orders tab.
  const userId = profile?.id ?? null;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="focus-ring sr-only z-50 rounded-full bg-brand-teal-deep px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <AppHeader storefront={storefront} userId={userId} />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-tabbar outline-none md:pt-8 md:pb-16">
        {children}
      </main>
      <BottomTabs userId={userId} />
      <CartSync locationId={storefront.selected?.id ?? null} />
    </div>
  );
}

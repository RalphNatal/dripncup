import type { ReactNode } from "react";

import { AppHeader } from "@/components/shell/app-header";
import { CartSync } from "@/components/shell/cart-sync";
import { BottomTabs } from "@/components/shell/nav";
import { SiteFooter } from "@/components/shell/site-footer";
import { SkipLink } from "@/components/skip-link";
import { RouteFocus } from "@/components/route-focus";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getLogoUrl } from "@/lib/content/queries";
import { getStorefront } from "@/lib/locations/storefront";
import { listActiveOrders } from "@/lib/orders/queries";

/**
 * The customer app shell: header with the pickup location and cart, the page,
 * and the bottom tab bar on phones. Everything a customer sees lives here;
 * /staff, /admin and the sign-in pages have their own frames.
 */
export default async function ShopLayout({ children }: { children: ReactNode }) {
  const [storefront, profile, logoUrl] = await Promise.all([getStorefront(), getCurrentProfile(), getLogoUrl()]);
  // Drives the live "order in progress" dot on the Orders tab. The server
  // reads the active orders too, so the dot's first render in the browser
  // matches the HTML (the navs seed the shared client query before any page
  // does); Realtime keeps it current after that.
  const userId = profile?.id ?? null;
  const activeOrders = userId ? await listActiveOrders().catch(() => []) : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <AppHeader storefront={storefront} userId={userId} activeOrders={activeOrders} logoUrl={logoUrl} />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 outline-none md:pt-8">
        {children}
      </main>
      <SiteFooter />
      <BottomTabs userId={userId} activeOrders={activeOrders} />
      <CartSync locationId={storefront.selected?.id ?? null} />
      <RouteFocus />
    </div>
  );
}

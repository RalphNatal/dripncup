import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { LocationPicker } from "@/components/locations/location-picker";
import { CartButton } from "@/components/shell/cart-button";
import { DesktopNav } from "@/components/shell/nav";
import { StickyHeader } from "@/components/shell/sticky-header";
import { BRAND } from "@/lib/brand";
import type { Storefront } from "@/lib/locations/storefront";
import type { OrderListItem } from "@/lib/orders/list";

/**
 * Phone: logo and cart on the first row, the pickup location on the second.
 * Desktop: one row -- logo, the five tabs, location, cart.
 */
export function AppHeader({
  storefront,
  userId,
  activeOrders,
}: {
  storefront: Storefront;
  userId: string | null;
  /** Server-read, so the Orders dot hydrates as rendered. */
  activeOrders: OrderListItem[];
}) {
  return (
    <StickyHeader>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 px-4 md:h-16 md:flex-nowrap">
        <Link href="/" aria-label={`${BRAND.name} home`} className="focus-ring order-1 flex h-14 items-center rounded-lg md:h-auto">
          <Logo size="sm" />
        </Link>

        <DesktopNav userId={userId} activeOrders={activeOrders} className="order-2 hidden md:ml-4 md:block" />

        <div className="order-2 ml-auto md:order-4 md:ml-0">
          <CartButton />
        </div>

        <div className="order-3 -mx-2 w-[calc(100%+1rem)] border-t pt-0.5 pb-1 md:mx-0 md:ml-auto md:w-auto md:border-0 md:p-0">
          <LocationPicker locations={storefront.locations} selected={storefront.selected} />
        </div>
      </div>
    </StickyHeader>
  );
}

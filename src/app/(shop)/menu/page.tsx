import { CalendarDays, CupSoda } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { CollectionBanner, OrderingUnavailableBanner } from "@/components/menu/banners";
import { MenuBrowser } from "@/components/menu/menu-browser";
import { getMenuPageData } from "@/lib/menu/queries";

export const metadata: Metadata = { title: "Menu" };

/**
 * Server-rendered menu for the selected location. The catalogue comes from
 * cache; the location's status and sold-out list are read fresh each request.
 */
export default async function MenuPage() {
  const data = await getMenuPageData();

  if (!data) {
    return (
      <EmptyState icon={CupSoda} title="The menu is on its way">
        We&apos;re getting set up. Check back soon.
      </EmptyState>
    );
  }

  const { location, menu } = data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-extrabold">Menu</h1>
        <p className="text-sm text-muted-foreground">Pickup at {location.name}</p>
      </div>

      <OrderingUnavailableBanner location={location} />

      {!menu.menuPublished ? (
        <EmptyState icon={CalendarDays} title="This pop-up's menu is coming soon">
          We&apos;ll post what we&apos;re pouring at {location.name} before the event. Switch back to the cafe to see
          the full menu.
        </EmptyState>
      ) : menu.sections.length === 0 ? (
        <EmptyState icon={CupSoda} title="The menu is being updated">
          Nothing to order here right now. Please check back shortly.
        </EmptyState>
      ) : (
        <MenuBrowser
          sections={menu.sections}
          featured={menu.collection ? <CollectionBanner collection={menu.collection} /> : undefined}
        />
      )}
    </div>
  );
}

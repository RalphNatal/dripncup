"use client";

/**
 * Parts of Home and the menu only signed-in customers see (favourites, live
 * order cards, "Order again"), loaded only when they render. Next bundles
 * every client component a page imports into that page's JavaScript whether
 * it renders or not, so importing these directly made every guest download
 * the favourites and reorder dialogs. Declared here because next/dynamic only
 * splits code when called from a client module. They still render on the
 * server, so nothing changes for the customer who sees them.
 */
import dynamic from "next/dynamic";

export const FavoritesRow = dynamic(() => import("@/components/favorites/favorites-list").then((m) => m.FavoritesRow));
export const ActiveOrderCards = dynamic(() => import("@/components/orders/order-lists").then((m) => m.ActiveOrderCards));
export const PastOrderRow = dynamic(() => import("@/components/orders/order-lists").then((m) => m.PastOrderRow));

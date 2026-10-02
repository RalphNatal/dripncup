import { Heart } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FavoritesManager } from "@/components/favorites/favorites-list";
import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";
import { listFavorites } from "@/lib/favorites/queries";
import { FAVORITES_LIMIT } from "@/lib/favorites/schemas";

export const metadata: Metadata = { title: "Favorites" };

/** Account → Favorites: every saved drink, checked against today's menu at the selected location. */
export default async function FavoritesPage() {
  await requireProfile("/account/favorites");
  const list = await listFavorites();

  return (
    <PageShell title="Favorites" backHref="/account" backLabel="Account">
      {!list || list.favorites.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No favorites yet"
          action={
            <Link
              href="/menu"
              className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
            >
              Browse the menu
            </Link>
          }
        >
          Customize a drink, then tap “Save as favorite” to keep it here as your usual.
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Prices and availability are for {list.location.name}. {list.favorites.length} of {FAVORITES_LIMIT} saved.
          </p>
          <FavoritesManager list={list} />
        </>
      )}
    </PageShell>
  );
}

"use client";

/**
 * Favourites, two ways: a quick horizontal row on Home and the Menu, and the
 * full list under Account → Favorites (rename, delete, add to cart).
 *
 * "Add to cart" re-checks the favourite against the live menu first (the
 * same check as "Order again"), so a favourite that has since sold out or
 * changed is never added blindly; the price added is today's.
 */
import { CircleAlert, Heart, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { FavoriteNameForm } from "@/components/favorites/save-favorite";
import { useCartStore } from "@/lib/cart/store";
import { deleteFavoriteAction, renameFavoriteAction, reviewFavoriteAction } from "@/lib/favorites/actions";
import type { FavoriteView, FavoritesList } from "@/lib/favorites/queries";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Checks one favourite live and, if it can be made, adds it to the cart. */
function useAddFavorite() {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const router = useRouter();

  async function add(favorite: Pick<FavoriteView, "id" | "name">) {
    setPendingId(favorite.id);
    try {
      const result = await reviewFavoriteAction(favorite.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (!result.ordering.canOrder) {
        toast.error(result.ordering.reason ?? "We're not taking orders right now.");
        return;
      }
      if (result.review.status === "unavailable") {
        toast.error(`“${favorite.name}” can't be added: ${result.review.reason}`);
        router.refresh();
        return;
      }
      useCartStore.getState().addLine(result.review.line);
      toast.success(`Added “${favorite.name}” to your cart · ${formatCents(result.review.unitPriceCents)}`, {
        action: { label: "View cart", onClick: () => router.push("/cart") },
      });
    } finally {
      setPendingId(null);
    }
  }

  return { add, pendingId };
}

function AddButton({
  favorite,
  disabled,
  pending,
  onAdd,
  compact,
}: {
  favorite: FavoriteView;
  disabled: boolean;
  pending: boolean;
  onAdd: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled || pending}
      aria-label={`Add ${favorite.name} to cart`}
      className={cn(
        "focus-ring inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand-teal-deep px-4 text-sm font-bold text-white hover:bg-brand-teal-deep/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
        compact && "px-3",
      )}
    >
      {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
      {compact ? "Add" : "Add to cart"}
    </button>
  );
}

/** The quick row for Home and the top of the Menu. Renders nothing without favourites. */
export function FavoritesRow({ list, className }: { list: FavoritesList; className?: string }) {
  const { add, pendingId } = useAddFavorite();
  if (list.favorites.length === 0) return null;

  return (
    <section aria-labelledby="favorites-row-heading" className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="favorites-row-heading" className="flex items-center gap-2 text-lg font-bold">
          <Heart className="size-5 text-brand-magenta-deep" aria-hidden="true" />
          Your favorites
        </h2>
        <Link href="/account/favorites" className="focus-ring rounded text-sm font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
          See all
        </Link>
      </div>
      <ul className="-mx-4 mt-2 flex snap-x gap-3 overflow-x-auto px-4 pb-2" data-testid="favorites-row">
        {list.favorites.map((favorite) => {
          const unavailable = favorite.review.status === "unavailable";
          return (
            <li key={favorite.id} className="flex w-60 shrink-0 snap-start flex-col rounded-2xl border bg-card p-3">
              <p className="truncate font-bold">{favorite.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {[favorite.productName, ...favorite.savedSummary].join(" · ")}
              </p>
              <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                {favorite.review.status === "unavailable" ? (
                  <p className="text-xs font-medium text-muted-foreground">{favorite.review.reason}</p>
                ) : (
                  <p className="tabular text-sm font-semibold">{formatCents(favorite.review.unitPriceCents)}</p>
                )}
                <AddButton
                  compact
                  favorite={favorite}
                  disabled={unavailable || !list.ordering.canOrder}
                  pending={pendingId === favorite.id}
                  onAdd={() => void add(favorite)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Account → Favorites. */
export function FavoritesManager({ list }: { list: FavoritesList }) {
  const { add, pendingId } = useAddFavorite();

  return (
    <div className="space-y-3">
      {!list.ordering.canOrder && list.ordering.reason ? (
        <p className="flex gap-2 rounded-2xl bg-muted p-3 text-sm font-medium">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {list.ordering.reason}
        </p>
      ) : null}
      <ul className="space-y-3" aria-label="Favorites">
        {list.favorites.map((favorite) => (
          <FavoriteCard
            key={favorite.id}
            favorite={favorite}
            canOrder={list.ordering.canOrder}
            locationName={list.location.name}
            adding={pendingId === favorite.id}
            onAdd={() => void add(favorite)}
          />
        ))}
      </ul>
    </div>
  );
}

function FavoriteCard({
  favorite,
  canOrder,
  locationName,
  adding,
  onAdd,
}: {
  favorite: FavoriteView;
  canOrder: boolean;
  locationName: string;
  adding: boolean;
  onAdd: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [deleting, startDelete] = useTransition();
  const review = favorite.review;

  return (
    <li className="rounded-3xl border bg-card p-4" data-testid="favorite-card">
      {mode === "rename" ? (
        <FavoriteNameForm
          className="border-0 p-0"
          defaultName={favorite.name}
          submitLabel="Save name"
          onCancel={() => setMode("view")}
          onSubmit={async (name) => {
            const result = await renameFavoriteAction(favorite.id, name);
            if (!result.ok) return result.message;
            toast.success(`Renamed to “${result.name}”`);
            setMode("view");
            router.refresh();
            return null;
          }}
        />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold break-words">{favorite.name}</p>
            <p className="text-sm text-muted-foreground">{[favorite.productName, ...favorite.savedSummary].join(" · ")}</p>
          </div>
          {review.status !== "unavailable" ? (
            <p className="tabular shrink-0 font-semibold">{formatCents(review.unitPriceCents)}</p>
          ) : null}
        </div>
      )}

      {review.status === "unavailable" ? (
        <p className="mt-2 flex gap-1.5 text-sm font-medium">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Can&apos;t be added at {locationName} right now. {review.reason}
          </span>
        </p>
      ) : null}

      {mode === "delete" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-destructive/5 p-3" role="group" aria-label="Confirm removal">
          <p className="w-full text-sm font-semibold">Remove “{favorite.name}” from your favorites?</p>
          <button
            type="button"
            disabled={deleting}
            onClick={() =>
              startDelete(async () => {
                const result = await deleteFavoriteAction(favorite.id);
                if (!result.ok) {
                  toast.error(result.message ?? "We couldn't remove it.");
                  return;
                }
                toast.success(`Removed “${favorite.name}”`);
                router.refresh();
              })
            }
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full bg-destructive px-4 text-sm font-bold text-white hover:bg-destructive/90 disabled:opacity-60"
          >
            {deleting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            Remove
          </button>
          <button
            type="button"
            onClick={() => setMode("view")}
            className="focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted"
          >
            Keep it
          </button>
        </div>
      ) : mode === "view" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <AddButton favorite={favorite} disabled={review.status === "unavailable" || !canOrder} pending={adding} onAdd={onAdd} />
          <button
            type="button"
            onClick={() => setMode("rename")}
            aria-label={`Rename ${favorite.name}`}
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold hover:bg-muted"
          >
            <Pencil className="size-4" aria-hidden="true" />
            Rename
          </button>
          <button
            type="button"
            onClick={() => setMode("delete")}
            aria-label={`Delete ${favorite.name}`}
            className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold text-destructive hover:bg-destructive/5"
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
    </li>
  );
}

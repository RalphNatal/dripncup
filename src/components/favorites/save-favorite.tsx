"use client";

/**
 * "Save as favorite": a small inline form asking for a name (prefilled with
 * the product name, 40 characters at most). Used on the product sheet, after
 * customising, and on each line of a past order.
 */
import { Heart, LoaderCircle } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { saveFavoriteAction, saveFavoriteFromOrderItemAction, type FavoriteResult } from "@/lib/favorites/actions";
import { FAVORITE_NAME_MAX, defaultFavoriteName, favoriteNameSchema, type SaveFavoriteInput } from "@/lib/favorites/schemas";
import { cn } from "@/lib/utils";

export function FavoriteNameForm({
  defaultName,
  submitLabel,
  onSubmit,
  onCancel,
  className,
}: {
  defaultName: string;
  submitLabel: string;
  /** Resolves to an error message, or null when it worked. */
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
  className?: string;
}) {
  const uid = useId();
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const parsed = favoriteNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    startTransition(async () => {
      setError(await onSubmit(parsed.data));
    });
  }

  return (
    // A group, not a <form>: on the product sheet it sits inside the sheet's
    // own form, and Enter here must save the favourite, not add to the cart.
    <div role="group" aria-label="Save as favorite" className={cn("rounded-2xl border bg-card p-3", className)}>
      <label htmlFor={`${uid}-name`} className="text-sm font-semibold">
        Favorite name
      </label>
      <input
        id={`${uid}-name`}
        value={name}
        maxLength={FAVORITE_NAME_MAX}
        autoFocus
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (!pending) submit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${uid}-hint${error ? ` ${uid}-error` : ""}`}
        className="focus-ring mt-1 h-11 w-full rounded-xl border bg-background px-3 text-base"
      />
      <p id={`${uid}-hint`} className="tabular mt-1 text-xs text-muted-foreground">
        e.g. “My usual” · {name.length}/{FAVORITE_NAME_MAX}
      </p>
      {error ? (
        <p id={`${uid}-error`} role="alert" className="mt-1 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="focus-ring inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-4 text-sm font-bold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring inline-flex min-h-11 items-center justify-center rounded-full border px-4 text-sm font-semibold hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Toasts the outcome; returns the inline error to show, if any. */
function useFavoriteFeedback() {
  const router = useRouter();
  const pathname = usePathname();
  return (result: FavoriteResult): string | null => {
    if (result.ok) {
      toast.success(`Saved “${result.name}” to your favorites`, {
        action: { label: "View", onClick: () => router.push("/account/favorites") },
      });
      return null;
    }
    if (result.signedOut) {
      toast.error(result.message, {
        action: { label: "Sign in", onClick: () => router.push(`/sign-in?next=${encodeURIComponent(pathname)}`) },
      });
    }
    return result.message;
  };
}

function SaveTrigger({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-brand-magenta-deep hover:bg-brand-pink-soft",
        className,
      )}
    >
      <Heart className="size-4" aria-hidden="true" />
      Save as favorite
    </button>
  );
}

/**
 * On the product sheet. `prepare` returns what to save, or null when the
 * choices are not finished (the sheet then shows what is missing).
 */
export function SaveFavoriteFromSheet({
  productName,
  prepare,
}: {
  productName: string;
  prepare: () => Omit<SaveFavoriteInput, "name"> | null;
}) {
  const [open, setOpen] = useState(false);
  const feedback = useFavoriteFeedback();

  if (!open) {
    return (
      <SaveTrigger
        className="-ml-3"
        onClick={() => {
          if (prepare()) setOpen(true);
        }}
      />
    );
  }

  return (
    <FavoriteNameForm
      defaultName={defaultFavoriteName(productName)}
      submitLabel="Save favorite"
      onCancel={() => setOpen(false)}
      onSubmit={async (name) => {
        const input = prepare();
        if (!input) {
          setOpen(false);
          return null;
        }
        const error = feedback(await saveFavoriteAction({ ...input, name }));
        if (!error) setOpen(false);
        return error;
      }}
    />
  );
}

/** On a line of a past order: saved exactly as it was made. */
export function SaveFavoriteFromOrderItem({ itemId, productName }: { itemId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const feedback = useFavoriteFeedback();

  if (!open) return <SaveTrigger className="-ml-3 mt-1" onClick={() => setOpen(true)} />;

  return (
    <FavoriteNameForm
      className="mt-2"
      defaultName={defaultFavoriteName(productName)}
      submitLabel="Save favorite"
      onCancel={() => setOpen(false)}
      onSubmit={async (name) => {
        const error = feedback(await saveFavoriteFromOrderItemAction(itemId, name));
        if (!error) setOpen(false);
        return error;
      }}
    />
  );
}

"use client";

/**
 * "Order again": rebuilds a past order against today's menu and shows what
 * will happen before anything reaches the cart -- current prices (and which
 * changed), what is unavailable and why, and whether the order was for a
 * different pickup location. With a cart that already has items, it asks
 * whether to add to it or replace it.
 *
 * The lines it adds carry the current price for display only; the cart and
 * checkout re-price everything on the server, as for any other line.
 */
import { ArrowRight, CircleAlert, LoaderCircle, MapPin, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCartHydrated } from "@/lib/cart/hooks";
import { cartItemCount, useCartStore } from "@/lib/cart/store";
import { selectLocation } from "@/lib/locations/actions";
import { formatCents } from "@/lib/money";
import { reviewReorderAction } from "@/lib/orders/actions";
import { addableLines, type LineReview, type ReorderReview } from "@/lib/orders/reorder";
import { cn } from "@/lib/utils";

export function ReorderButton({ orderId, className, compact = false }: { orderId: string; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<ReorderReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      setError(null);
      const result = await reviewReorderAction(orderId);
      if ("error" in result) {
        setReview(null);
        setError(result.error);
      } else {
        setReview(result);
      }
    });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          load();
        }}
        className={cn(
          compact
            ? "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand-teal-deep/40 px-4 text-sm font-semibold text-brand-teal-deep hover:bg-brand-teal-soft"
            : "focus-ring flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-5 font-bold text-white hover:bg-brand-teal-deep/90",
          className,
        )}
      >
        <RotateCcw className={compact ? "size-4" : "size-5"} aria-hidden="true" />
        Order again
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] gap-0 overflow-y-auto p-0 sm:max-w-md">
          <div className="p-5 pb-3">
            <DialogTitle className="text-xl font-extrabold">Order again</DialogTitle>
            <DialogDescription className="mt-1">
              {review ? `From order ${review.orderNumber}, checked against today's menu.` : "Checking today's menu…"}
            </DialogDescription>
          </div>
          {review ? (
            <ReviewBody review={review} reloading={pending} onReload={load} onDone={() => setOpen(false)} />
          ) : error ? (
            <p role="alert" className="px-5 pb-5 font-semibold text-destructive">
              {error}
            </p>
          ) : (
            <div className="flex justify-center px-5 pt-2 pb-8" role="status">
              <LoaderCircle className="size-8 animate-spin text-brand-teal-deep" aria-hidden="true" />
              <span className="sr-only">Checking today&apos;s menu</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ReviewBody({
  review,
  reloading,
  onReload,
  onDone,
}: {
  review: ReorderReview;
  reloading: boolean;
  onReload: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const hydrated = useCartHydrated();
  const cartLines = useCartStore((s) => s.lines);
  const [switching, startSwitch] = useTransition();
  const addable = addableLines(review);
  const itemCount = addable.reduce((sum, l) => sum + l.quantity, 0);
  const cartHasItems = hydrated && cartLines.length > 0;
  const blocked = !review.ordering.canOrder || addable.length === 0;

  function add(mode: "add" | "replace") {
    const cart = useCartStore.getState();
    if (mode === "replace") cart.clear();
    for (const line of addable) cart.addLine(line.line);
    toast.success(`Added ${itemCount} ${itemCount === 1 ? "item" : "items"} to your cart`);
    onDone();
    router.push("/cart");
  }

  function switchLocation() {
    startSwitch(async () => {
      const result = await selectLocation(review.location.ordered.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.refresh();
      onReload();
    });
  }

  return (
    <div className={cn(reloading && "opacity-60")}>
      {review.location.mismatch ? (
        <div className="mx-5 mb-3 flex gap-3 rounded-2xl border border-brand-teal-deep/30 bg-brand-teal-soft/50 p-3 text-sm" data-testid="reorder-location-note">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
          <div>
            <p>
              This order was from <strong>{review.location.ordered.name}</strong>. You&apos;re ordering from{" "}
              <strong>{review.location.selected.name}</strong>, so prices and availability are from there.
            </p>
            {review.location.canSwitch ? (
              <button
                type="button"
                onClick={switchLocation}
                disabled={switching || reloading}
                className="focus-ring mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-teal-deep px-4 font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
              >
                {switching ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
                Switch to {review.location.ordered.name}
              </button>
            ) : (
              <p className="mt-1 text-muted-foreground">{review.location.ordered.name} isn&apos;t taking orders now.</p>
            )}
          </div>
        </div>
      ) : null}

      {!review.ordering.canOrder ? (
        <p className="mx-5 mb-3 flex gap-2 rounded-2xl bg-muted p-3 text-sm font-medium">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {review.ordering.reason ?? `${review.location.selected.name} isn't taking orders right now.`}
        </p>
      ) : null}

      <ul className="divide-y border-y" aria-label="Items">
        {review.lines.map((line) => (
          <ReviewRow key={line.key} line={line} />
        ))}
      </ul>

      <div className="space-y-2 p-5">
        {cartHasItems && !blocked ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your cart already has {cartItemCount(cartLines)} {cartItemCount(cartLines) === 1 ? "item" : "items"}.
            </p>
            <button
              type="button"
              onClick={() => add("add")}
              className="focus-ring flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-5 font-bold text-white hover:bg-brand-teal-deep/90"
            >
              Add to my cart
            </button>
            <button
              type="button"
              onClick={() => add("replace")}
              className="focus-ring flex min-h-12 w-full items-center justify-center gap-2 rounded-full border bg-card px-5 font-bold hover:bg-muted"
            >
              Replace my cart
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => add("add")}
            disabled={blocked || reloading}
            className="focus-ring flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-5 font-bold text-white hover:bg-brand-teal-deep/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          >
            {addable.length === 0
              ? "Nothing here can be ordered right now"
              : `Add ${itemCount} ${itemCount === 1 ? "item" : "items"} to cart`}
            {addable.length > 0 ? <ArrowRight className="size-5" aria-hidden="true" /> : null}
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ line }: { line: LineReview }) {
  const unavailable = line.status === "unavailable";
  return (
    <li className={cn("px-5 py-3", unavailable && "bg-muted/40")} data-testid="reorder-line" data-status={line.status}>
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("font-semibold", unavailable && "text-muted-foreground line-through")}>
            <span className="tabular">{line.quantity}×</span> {line.name}
          </p>
          {line.summary.length > 0 ? <p className="text-sm text-muted-foreground">{line.summary.join(" · ")}</p> : null}
        </div>
        {!unavailable ? (
          <p className="tabular shrink-0 font-semibold">{formatCents(line.unitPriceCents * line.quantity)}</p>
        ) : null}
      </div>
      {line.status === "price_changed" && line.previousUnitPriceCents !== null ? (
        <p className="mt-1 text-sm font-medium text-warning">
          Price changed: {formatCents(line.previousUnitPriceCents)} → {formatCents(line.unitPriceCents)} each
        </p>
      ) : null}
      {unavailable ? (
        <p className="mt-1 flex gap-1.5 text-sm font-medium">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <span className="font-bold">Skipped.</span> {line.reason}
          </span>
        </p>
      ) : null}
    </li>
  );
}

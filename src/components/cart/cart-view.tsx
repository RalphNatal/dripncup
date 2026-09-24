"use client";

/**
 * The cart. Every line is re-checked on the server (checkCartAction) when the
 * page loads and after every change, with the same engine checkout uses:
 * removed or sold-out items, choices that no longer fit the menu, price
 * changes, and a cart built for a different location all show here. Price
 * changes are applied automatically, with a notice; anything blocking must be
 * fixed or removed before Checkout unlocks.
 */
import { CircleAlert, MapPin, ShoppingBag, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EditLineSheet } from "@/components/cart/edit-line-sheet";
import { QuantityStepper } from "@/components/cart/quantity-stepper";
import { EmptyState } from "@/components/empty-state";
import { StatusDot } from "@/components/locations/status-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { useCartHydrated } from "@/lib/cart/hooks";
import { useCartStore, type CartLine } from "@/lib/cart/store";
import { checkCartAction } from "@/lib/checkout/actions";
import type { CartCheck, CheckedLine } from "@/lib/checkout/types";
import type { LocationView } from "@/lib/locations/storefront";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

const RECHECK_DELAY_MS = 250;

function toInput(line: CartLine) {
  return {
    id: line.id,
    locationId: line.locationId,
    productId: line.productId,
    sizeId: line.sizeId,
    selection: line.selection,
    specialInstructions: line.specialInstructions,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
  };
}

export function CartView({
  signedIn,
  location,
}: {
  signedIn: boolean;
  location: Pick<LocationView, "id" | "name"> & { statusLabel: string; statusKind: LocationView["status"]["kind"] };
}) {
  const hydrated = useCartHydrated();
  const lines = useCartStore((s) => s.lines);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeLine = useCartStore((s) => s.removeLine);
  const moveLinesTo = useCartStore((s) => s.moveLinesTo);

  const payload = useMemo(() => lines.map(toInput), [lines]);
  const payloadKey = JSON.stringify(payload);

  const [check, setCheck] = useState<{ key: string; result: CartCheck } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Price changes seen this visit, kept after the line has been updated. */
  const [priceNotices, setPriceNotices] = useState<Record<string, { from: number; to: number }>>({});

  useEffect(() => {
    if (!hydrated || payload.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await checkCartAction(payload);
      if (cancelled) return;
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setCheck({ key: payloadKey, result });

      const changes = result.lines.flatMap((line) =>
        line.issues
          .filter((issue) => issue.code === "price_changed")
          .map((issue) => ({ id: line.id, from: issue.oldPriceCents!, to: issue.newPriceCents!, summary: line.current?.summary })),
      );
      if (changes.length > 0) {
        setPriceNotices((previous) => ({
          ...previous,
          ...Object.fromEntries(changes.map((c) => [c.id, { from: c.from, to: c.to }])),
        }));
        useCartStore.getState().applyPrices(changes.map((c) => ({ id: c.id, unitPriceCents: c.to, summary: c.summary })));
      }
    }, RECHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // payloadKey captures every change to `payload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, payloadKey]);

  if (!hydrated) {
    return (
      <div aria-busy="true" aria-label="Loading your cart" className="space-y-3">
        <Skeleton className="h-24 w-full rounded-3xl" />
        <Skeleton className="h-24 w-full rounded-3xl" />
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Your cart is empty"
        action={
          <Link
            href="/menu"
            className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
          >
            Browse the menu
          </Link>
        }
      >
        Add a drink or a snack and it will wait for you here.
      </EmptyState>
    );
  }

  const current = check && check.key === payloadKey ? check.result : null;
  const checkedById = new Map<string, CheckedLine>((current?.lines ?? check?.result.lines ?? []).map((l) => [l.id, l]));
  const wrongLocationIds = (current?.lines ?? [])
    .filter((l) => l.issues.some((i) => i.code === "wrong_location"))
    .map((l) => l.id);
  const subtotal = lines.reduce(
    (sum, line) => sum + (checkedById.get(line.id)?.current?.unitPriceCents ?? line.unitPriceCents) * line.quantity,
    0,
  );
  const blockingCount = (current?.lines ?? []).filter((l) => l.issues.some((i) => i.blocking)).length;
  const canCheckout = Boolean(current && !current.blocked);

  return (
    <div className="space-y-4">
      <section aria-label="Pickup location" className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm">
        <MapPin className="size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Pickup at {location.name}</span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <StatusDot kind={location.statusKind} />
            {location.statusLabel}
          </span>
        </span>
      </section>

      {current?.location.blockedReason ? (
        <Notice tone="warning" title="Checkout isn't available right now">
          {current.location.blockedReason}
        </Notice>
      ) : null}

      {wrongLocationIds.length > 0 ? (
        <Notice tone="warning" title={`Some items were added for a different pickup location`}>
          <p>They&apos;ve been checked against {location.name}&apos;s menu below.</p>
          <button
            type="button"
            onClick={() => moveLinesTo(location.id, wrongLocationIds)}
            className="focus-ring mt-2 inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-4 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
          >
            Order them from {location.name}
          </button>
        </Notice>
      ) : null}

      {error ? <Notice tone="error" title="We couldn't check your cart">{error}</Notice> : null}

      <ul className="space-y-3" aria-label="Items in your cart">
        {lines.map((line) => {
          const checked = checkedById.get(line.id);
          const unit = checked?.current?.unitPriceCents ?? line.unitPriceCents;
          const summary = checked?.current?.summary ?? line.summary;
          const issues = (checked?.issues ?? []).filter((i) => i.code !== "price_changed" && i.code !== "wrong_location");
          const priceNotice = priceNotices[line.id];
          const blocking = issues.some((i) => i.blocking);

          return (
            <li key={line.id}>
              <article
                aria-labelledby={`line-${line.id}`}
                className={cn("rounded-3xl border bg-card p-4", blocking && "border-destructive/60")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={`line-${line.id}`} className="text-lg leading-tight font-bold">
                      {checked?.current?.productName ?? line.productName}
                    </h2>
                    {summary.length > 0 ? <p className="mt-0.5 text-sm text-muted-foreground">{summary.join(" · ")}</p> : null}
                    {line.specialInstructions ? (
                      <p className="mt-1 text-sm italic">“{line.specialInstructions}”</p>
                    ) : null}
                  </div>
                  <p className="tabular shrink-0 text-base font-bold">{formatCents(unit * line.quantity)}</p>
                </div>

                {issues.map((issue) => (
                  <p key={issue.code} className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-destructive">
                    <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {issue.message}
                  </p>
                ))}
                {priceNotice ? (
                  <p className="mt-2 rounded-xl bg-muted px-3 py-1.5 text-sm">
                    Price updated: <span className="tabular line-through">{formatCents(priceNotice.from)}</span> →{" "}
                    <span className="tabular font-semibold">{formatCents(priceNotice.to)}</span> each
                  </p>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <QuantityStepper
                    label={line.productName}
                    value={line.quantity}
                    onChange={(next) => setQuantity(line.id, next)}
                    onRemove={() => removeLine(line.id)}
                  />
                  <div className="flex items-center gap-1">
                    {checked?.current ? <EditLineSheet line={line} /> : null}
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="focus-ring inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      Remove<span className="sr-only"> {line.productName}</span>
                    </button>
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      <section aria-labelledby="cart-summary" className="rounded-3xl border bg-card p-4">
        <h2 id="cart-summary" className="sr-only">
          Summary
        </h2>
        <div className="flex items-baseline justify-between text-base">
          <span className="font-semibold">Subtotal</span>
          <span className="tabular font-bold">{formatCents(subtotal)}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Tax (GET), tip and promo codes are added at checkout.</p>

        <p className="sr-only" aria-live="polite">
          {current ? (blockingCount > 0 ? `${blockingCount} item${blockingCount === 1 ? "" : "s"} need attention.` : "") : "Checking your cart…"}
        </p>
        {blockingCount > 0 ? (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <CircleAlert className="size-4" aria-hidden="true" />
            Fix or remove {blockingCount === 1 ? "the item" : `the ${blockingCount} items`} marked above to check out.
          </p>
        ) : null}

        <div className="mt-4">
          {signedIn ? (
            canCheckout ? (
              <Link
                href="/checkout"
                className="focus-ring flex min-h-12 w-full items-center justify-center rounded-full bg-brand-teal-deep px-5 text-base font-bold text-white hover:bg-brand-teal-deep/90"
              >
                Checkout · {formatCents(subtotal)}
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-full bg-muted px-5 text-base font-bold text-muted-foreground"
              >
                {current ? "Checkout" : "Checking your cart…"}
              </button>
            )
          ) : (
            <Link
              href="/sign-in?next=/checkout"
              className="focus-ring flex min-h-12 w-full items-center justify-center rounded-full bg-brand-teal-deep px-5 text-base font-bold text-white hover:bg-brand-teal-deep/90"
            >
              Sign in to check out
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "warning" | "error"; title: string; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-3 rounded-2xl border p-4 text-sm",
        tone === "warning"
          ? "border-warning/30 bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))]"
          : "border-destructive/40 bg-[color-mix(in_oklab,var(--destructive)_6%,var(--card))]",
      )}
    >
      <TriangleAlert className={cn("mt-0.5 size-5 shrink-0", tone === "warning" ? "text-warning" : "text-destructive")} aria-hidden="true" />
      <div>
        <p className="font-bold">{title}</p>
        <div className="mt-0.5 text-foreground/80">{children}</div>
      </div>
    </div>
  );
}

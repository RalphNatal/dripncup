"use client";

/**
 * Lists of the customer's orders: the live active-order cards (Home and the
 * Orders page) and the paginated past-order history.
 */
import { ChevronRight, Clock, LoaderCircle, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { ReorderButton } from "@/components/orders/reorder";
import { OrderStatusBadge } from "@/components/orders/status-badge";
import { formatCents } from "@/lib/money";
import { ORDER_STATUS_DESCRIPTIONS } from "@/lib/order-status";
import { loadMorePastOrdersAction } from "@/lib/orders/actions";
import type { OrderListItem } from "@/lib/orders/list";
import { useActiveOrders } from "@/lib/orders/live";
import type { PastOrdersPage } from "@/lib/orders/queries";
import { formatCafeDate, formatCafeDateWithYear, formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

function etaLine(order: OrderListItem): string {
  if (order.status === "ready") return "Ready now. Come and get it!";
  if (order.pickupType === "scheduled" && order.scheduledFor) {
    const at = new Date(order.scheduledFor);
    return `Pickup ${formatCafeDate(at)} at ${formatCafeTimeOfDay(at)}`;
  }
  return order.estimatedReadyAt ? `Ready around ${formatCafeTimeOfDay(new Date(order.estimatedReadyAt))}` : ORDER_STATUS_DESCRIPTIONS[order.status];
}

/**
 * One card per order in Placed through Ready, stacked, each linking to its
 * tracker. Live: a status change anywhere shows up here without a reload.
 */
export function ActiveOrderCards({
  userId,
  initial,
  heading,
  className,
}: {
  userId: string;
  initial?: OrderListItem[];
  /** Defaults to "Your order(s)". */
  heading?: string;
  className?: string;
}) {
  const orders = useActiveOrders(userId, initial);
  if (orders.length === 0) return null;

  return (
    <section aria-labelledby="active-orders-heading" className={cn("space-y-2", className)}>
      <h2 id="active-orders-heading" className="text-lg font-bold">
        {heading ?? (orders.length === 1 ? "Your order" : `Your orders (${orders.length})`)}
      </h2>
      <ul className="space-y-2" data-testid="active-orders">
        {orders.map((order) => {
          const ready = order.status === "ready";
          return (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className={cn(
                  "focus-ring flex items-center gap-3 rounded-3xl border p-4 transition-colors",
                  ready ? "border-brand-magenta-deep bg-brand-pink-soft" : "bg-card hover:bg-muted/50",
                )}
                data-testid="active-order-card"
              >
                {ready ? (
                  <PartyPopper className="size-7 shrink-0 text-brand-magenta-deep" aria-hidden="true" />
                ) : (
                  <Clock className="size-7 shrink-0 text-brand-teal-deep" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="tabular font-bold">{order.orderNumber}</span>
                    <OrderStatusBadge status={order.status} />
                  </p>
                  <p className="mt-0.5 text-sm font-semibold">{etaLine(order)}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {order.summary} · {order.locationName}
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A past order: tap for the full receipt; "Order again" beside it. */
export function PastOrderRow({ order }: { order: OrderListItem }) {
  return (
    <li className="rounded-3xl border bg-card" data-testid="past-order">
      <Link href={`/orders/${order.id}`} className="focus-ring block rounded-t-3xl p-4 hover:bg-muted/40">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="tabular font-bold">{order.orderNumber}</span>
              <OrderStatusBadge status={order.status} />
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              <time dateTime={order.placedAt ?? order.createdAt}>
                {formatCafeDateWithYear(new Date(order.placedAt ?? order.createdAt))}
              </time>{" "}
              · {order.locationName}
            </p>
            <p className="mt-1 truncate">{order.summary}</p>
          </div>
          <p className="tabular shrink-0 font-bold">{formatCents(order.totalCents)}</p>
        </div>
      </Link>
      <div className="border-t px-4 py-2">
        <ReorderButton orderId={order.id} compact />
      </div>
    </li>
  );
}

/** Past orders, newest first, with "Load more" (keyset pagination). */
export function PastOrdersList({ initial }: { initial: PastOrdersPage }) {
  const [orders, setOrders] = useState(initial.orders);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (!cursor) return;
    startTransition(async () => {
      const result = await loadMorePastOrdersAction(cursor);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setOrders((current) => [...current, ...result.orders.filter((o) => !current.some((c) => c.id === o.id))]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <div>
      <ul className="space-y-3">
        {orders.map((order) => (
          <PastOrderRow key={order.id} order={order} />
        ))}
      </ul>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="focus-ring mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full border bg-card px-5 font-bold hover:bg-muted disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : null}
          Load more orders
        </button>
      ) : null}
    </div>
  );
}

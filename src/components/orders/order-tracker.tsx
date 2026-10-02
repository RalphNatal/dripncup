"use client";

/**
 * The live order page (/orders/[id]): status timeline, the Ready alert,
 * pickup details, items and the receipt. Starts from the server-rendered
 * order and stays current through useLiveOrder (Realtime, with a refetch on
 * reconnect and a polling fallback).
 */
import { Clock, CreditCard, MapPin, Receipt, Wifi, WifiOff } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { OrderBreakdown } from "@/components/checkout/order-breakdown";
import { SaveFavoriteFromOrderItem } from "@/components/favorites/save-favorite";
import { DirectionsLink } from "@/components/locations/directions-link";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { ReadyAlert } from "@/components/orders/ready-alert";
import { ReorderButton } from "@/components/orders/reorder";
import { OrderStatusBadge } from "@/components/orders/status-badge";
import { formatCents } from "@/lib/money";
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_DESCRIPTIONS } from "@/lib/order-status";
import { paymentMethodLabel, type OrderDetail } from "@/lib/orders/detail";
import { useLiveOrder } from "@/lib/orders/live";
import { buildTimeline } from "@/lib/orders/timeline";
import { formatCafeDate, formatCafeDateTime, formatCafeTimeOfDay } from "@/lib/time";

/** "Ready around 9:40 AM", "Pickup Fri, Oct 3 at 10:15 AM", "Picked up Oct 3, 9:52 AM". */
function pickupLine(order: OrderDetail): string | null {
  if (order.status === "picked_up" && order.times.pickedUp) return `Picked up ${formatCafeDateTime(new Date(order.times.pickedUp))}`;
  if (order.status === "ready") return "Ready now";
  if (!(ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status)) return null;
  if (order.pickupType === "scheduled" && order.scheduledFor) {
    const at = new Date(order.scheduledFor);
    return `Pickup ${formatCafeDate(at)} at ${formatCafeTimeOfDay(at)}`;
  }
  return order.estimatedReadyAt ? `Ready around ${formatCafeTimeOfDay(new Date(order.estimatedReadyAt))}` : "We'll have it ready soon";
}

export function OrderTracker({ initial }: { initial: OrderDetail }) {
  const { order, live } = useLiveOrder(initial);
  const timeline = useMemo(() => buildTimeline(order), [order]);
  const active = (ACTIVE_ORDER_STATUSES as readonly string[]).includes(order.status);
  const past = order.status === "picked_up" || order.status === "cancelled" || order.status === "refunded";
  const pickup = pickupLine(order);
  const method = paymentMethodLabel(order.payment?.method ?? null);

  return (
    <div className="space-y-4">
      <header>
        <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Order</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="tabular text-3xl font-extrabold" data-testid="order-number">
            {order.orderNumber}
          </h1>
          <OrderStatusBadge status={order.status} className="text-sm" />
        </div>
        <p className="mt-1 text-muted-foreground" aria-live="polite" data-testid="order-status-description">
          {ORDER_STATUS_DESCRIPTIONS[order.status]}
        </p>
        {active ? (
          <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {live ? <Wifi className="size-3.5" aria-hidden="true" /> : <WifiOff className="size-3.5" aria-hidden="true" />}
            {live ? "Live updates on" : "Reconnecting… checking for updates every 15 seconds"}
          </p>
        ) : null}
      </header>

      <ReadyAlert status={order.status} orderId={order.id} orderNumber={order.orderNumber} locationName={order.location.name} />

      <section aria-labelledby="progress-heading" className="rounded-3xl border bg-card p-4 sm:p-5">
        <h2 id="progress-heading" className="sr-only">
          Progress
        </h2>
        <OrderTimeline timeline={timeline} />
      </section>

      <section aria-labelledby="pickup-heading" className="rounded-3xl border bg-card p-4 sm:p-5">
        <h2 id="pickup-heading" className="sr-only">
          Pickup
        </h2>
        {pickup ? (
          <p className="mb-3 flex items-center gap-2 text-lg font-bold" data-testid="pickup-time">
            <Clock className="size-5 text-brand-teal-deep" aria-hidden="true" />
            {pickup}
          </p>
        ) : null}
        <div className="flex gap-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-bold">{order.location.name}</p>
            {order.location.addressLines.map((line) => (
              <p key={line} className="text-sm text-muted-foreground">
                {line}
              </p>
            ))}
            {active && order.location.pickupInstructions ? (
              <p className="mt-2 text-sm">{order.location.pickupInstructions}</p>
            ) : null}
            {order.cupName ? (
              <p className="mt-2 text-sm">
                Name on the cup: <span className="font-semibold">{order.cupName}</span>
              </p>
            ) : null}
            {active && order.location.addressOneLine ? (
              <DirectionsLink destination={`${order.location.name}, ${order.location.addressOneLine}`} className="mt-3" />
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="items-heading" className="rounded-3xl border bg-card p-4 sm:p-5">
        <h2 id="items-heading" className="flex items-center gap-2 font-bold">
          <Receipt className="size-5 text-brand-teal-deep" aria-hidden="true" />
          Your order
        </h2>
        <ul className="mt-2 divide-y">
          {order.items.map((item) => (
            <li key={item.id} className="py-2.5">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="tabular">{item.quantity}×</span> {item.name}
                  </p>
                  {[item.sizeName, ...item.options].filter(Boolean).length > 0 ? (
                    <p className="text-sm text-muted-foreground">{[item.sizeName, ...item.options].filter(Boolean).join(" · ")}</p>
                  ) : null}
                  {item.specialInstructions ? <p className="text-sm italic">“{item.specialInstructions}”</p> : null}
                </div>
                <p className="tabular shrink-0 font-semibold">{formatCents(item.lineTotalCents)}</p>
              </div>
              {past && item.productId ? <SaveFavoriteFromOrderItem itemId={item.id} productName={item.name} /> : null}
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t pt-3">
          <OrderBreakdown
            totalLabel={order.payment && order.payment.status !== "requires_payment" ? "Paid" : "Total"}
            values={{
              subtotalCents: order.totals.subtotalCents,
              promoCode: order.totals.promoCode,
              promoDiscountCents: order.totals.discountCents,
              rewardDiscountCents: 0,
              taxRate: order.totals.taxRate,
              taxCents: order.totals.taxCents,
              tipCents: order.totals.tipCents,
              totalCents: order.totals.totalCents,
            }}
          />
          {method ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" data-testid="payment-method">
              <CreditCard className="size-4" aria-hidden="true" />
              {method}
            </p>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row">
        {past ? <ReorderButton orderId={order.id} className="flex-1" /> : null}
        <Link
          href="/orders"
          className="focus-ring flex min-h-12 flex-1 items-center justify-center rounded-full border bg-card px-5 font-bold hover:bg-muted"
        >
          All orders
        </Link>
      </div>
    </div>
  );
}

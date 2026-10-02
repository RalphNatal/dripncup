"use client";

/**
 * After payment. The order only becomes Placed when Stripe's webhook says the
 * money arrived, so this page shows "Confirming your payment…" and checks
 * back until it does. A failed payment can be retried here, on the same
 * order. Once it is Placed, "Track your order" leads to the live tracker
 * (/orders/[id]).
 */
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CircleX, LoaderCircle, MapPin, PartyPopper, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { OrderBreakdown } from "@/components/checkout/order-breakdown";
import { getStripe, stripeAppearance, stripeFonts } from "@/components/checkout/stripe";
import { useCartHydrated } from "@/lib/cart/hooks";
import { useCartStore } from "@/lib/cart/store";
import { getOrderConfirmationAction, resumePaymentAction } from "@/lib/checkout/actions";
import { formatCents } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import type { OrderConfirmation } from "@/lib/orders/confirmation";
import { formatCafeDate, formatCafeTimeOfDay } from "@/lib/time";

const POLL_MS = 1500;
const SLOW_POLL_MS = 5000;
/** After this long, say it is taking a while (but keep checking). */
const PATIENCE_MS = 45_000;

type Phase = "confirming" | "unpaid" | "failed" | "placed" | "cancelled";

function phaseOf(order: OrderConfirmation, redirectStatus: string | null): Phase {
  if (order.status === "cancelled" || order.status === "refunded") return "cancelled";
  if (order.status !== "pending_payment") return "placed";
  if (redirectStatus === "succeeded" || redirectStatus === "processing" || order.payment?.status === "processing") {
    return "confirming";
  }
  if (redirectStatus === "failed" || order.payment?.status === "failed") return "failed";
  return "unpaid";
}

export function ConfirmationView({
  initial,
  redirectStatus,
  publishableKey,
}: {
  initial: OrderConfirmation;
  redirectStatus: string | null;
  publishableKey: string | null;
}) {
  const [order, setOrder] = useState(initial);
  const [slow, setSlow] = useState(false);
  const phase = phaseOf(order, redirectStatus);
  const hydrated = useCartHydrated();

  // Poll while the webhook is on its way.
  useEffect(() => {
    if (phase !== "confirming") return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const tick = async () => {
      const next = await getOrderConfirmationAction(order.id).catch(() => null);
      if (stopped) return;
      if (next) setOrder(next);
      const waited = Date.now() - started;
      if (waited > PATIENCE_MS) setSlow(true);
      timer = setTimeout(tick, waited > PATIENCE_MS ? SLOW_POLL_MS : POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase, order.id]);

  // The cart is only emptied once the order it became is really Placed.
  useEffect(() => {
    if (!hydrated) return;
    const cart = useCartStore.getState();
    if (phase === "placed") cart.clearForOrder(order.id);
    if (phase === "cancelled" && cart.pendingOrderId === order.id) cart.setPendingOrder(null);
  }, [hydrated, phase, order.id]);

  if (phase === "confirming") {
    return (
      <div className="py-16 text-center" role="status" aria-live="polite">
        <LoaderCircle className="mx-auto size-10 animate-spin text-brand-teal-deep" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-extrabold">Confirming your payment…</h1>
        <p className="mt-1 text-muted-foreground">This usually takes a few seconds. Please keep this page open.</p>
        {slow ? (
          <p className="mt-4 text-sm text-muted-foreground">
            This is taking longer than usual. We&apos;ll keep checking; you can also find the order under{" "}
            <Link href="/orders" className="font-semibold underline underline-offset-2">
              Orders
            </Link>
            .
          </p>
        ) : null}
      </div>
    );
  }

  if (phase === "failed" || phase === "unpaid") {
    return (
      <div>
        <div className="text-center">
          <CircleX className="mx-auto size-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-extrabold">
            {phase === "failed" ? "Your payment didn't go through" : "This order hasn't been paid yet"}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {phase === "failed"
              ? (order.payment?.failureMessage ?? "Nothing was charged. You can try again with the same or another card.")
              : "Pay below to send it to the barista."}
          </p>
        </div>
        <div className="mt-6 rounded-3xl border bg-card p-4 sm:p-5">
          <p className="mb-4 flex justify-between text-base font-bold">
            <span>Order {order.orderNumber}</span>
            <span className="tabular">{formatCents(order.totals.totalCents)}</span>
          </p>
          {publishableKey ? (
            <RetryPayment orderId={order.id} publishableKey={publishableKey} totalCents={order.totals.totalCents} />
          ) : (
            <p className="text-sm">Card payments aren&apos;t set up yet.</p>
          )}
        </div>
        <p className="mt-4 text-center text-sm">
          <Link href="/cart" className="font-semibold text-brand-teal-deep underline underline-offset-2">
            Back to your cart
          </Link>
        </p>
      </div>
    );
  }

  const pickupTime = order.pickupType === "scheduled" && order.scheduledFor ? new Date(order.scheduledFor) : null;
  const readyAt = order.estimatedReadyAt ? new Date(order.estimatedReadyAt) : null;

  return (
    <div>
      {phase === "placed" ? (
        <div className="text-center">
          <PartyPopper className="mx-auto size-10 text-brand-magenta-deep" aria-hidden="true" />
          <h1 className="mt-3 text-3xl font-extrabold">Mahalo!</h1>
          <p className="mt-1 text-muted-foreground">Your order is in. We&apos;ll have it ready for you.</p>
          <p className="mt-4 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Order number</p>
          <p className="tabular text-4xl font-extrabold" data-testid="order-number">
            {order.orderNumber}
          </p>
          <p className="mt-2 inline-flex rounded-full bg-brand-teal-soft px-3 py-1 text-sm font-semibold text-brand-teal-deep">
            {ORDER_STATUS_LABELS[order.status]}
          </p>
        </div>
      ) : (
        <div className="text-center">
          <CircleX className="mx-auto size-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-3 text-2xl font-extrabold">Order {order.orderNumber} was cancelled</h1>
          {order.cancellationReason ? <p className="mt-1">{order.cancellationReason}</p> : null}
          {order.payment && order.payment.refundedCents > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              We refunded {formatCents(order.payment.refundedCents)} to your card. Refunds can take 5–10 business days to show.
            </p>
          ) : null}
        </div>
      )}

      <section aria-label="Pickup" className="mt-6 rounded-3xl border bg-card p-4 sm:p-5">
        <div className="flex gap-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
          <div>
            <p className="font-bold">{order.location.name}</p>
            {order.location.addressLines.map((line) => (
              <p key={line} className="text-sm text-muted-foreground">
                {line}
              </p>
            ))}
            {phase === "placed" ? (
              <p className="mt-2 font-semibold">
                {pickupTime
                  ? `Pickup ${formatCafeDate(pickupTime)} at ${formatCafeTimeOfDay(pickupTime)}`
                  : readyAt
                    ? `Ready around ${formatCafeTimeOfDay(readyAt)}`
                    : "We'll have it ready soon"}
              </p>
            ) : null}
            {phase === "placed" && order.location.pickupInstructions ? (
              <p className="mt-1 text-sm text-muted-foreground">{order.location.pickupInstructions}</p>
            ) : null}
            {order.cupName ? <p className="mt-1 text-sm">Name on the cup: {order.cupName}</p> : null}
          </div>
        </div>
      </section>

      <section aria-label="Items" className="mt-4 rounded-3xl border bg-card p-4 sm:p-5">
        <ul className="divide-y">
          {order.items.map((item, index) => (
            <li key={index} className="flex justify-between gap-3 py-2.5">
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
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t pt-3">
          <OrderBreakdown
            totalLabel={phase === "placed" ? "Paid" : "Total"}
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
        </div>
      </section>

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        {phase === "placed" ? (
          <Link
            href={`/orders/${order.id}`}
            className="focus-ring flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand-teal-deep px-5 font-bold text-white hover:bg-brand-teal-deep/90"
          >
            Track your order
          </Link>
        ) : (
          <Link
            href="/orders"
            className="focus-ring flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand-teal-deep px-5 font-bold text-white hover:bg-brand-teal-deep/90"
          >
            Your orders
          </Link>
        )}
        <Link
          href="/menu"
          className="focus-ring flex min-h-12 flex-1 items-center justify-center rounded-full border bg-card px-5 font-bold hover:bg-muted"
        >
          Back to the menu
        </Link>
      </div>
    </div>
  );
}

/** Pay again for the same order: its existing PaymentIntent, a new card. */
function RetryPayment({ orderId, publishableKey, totalCents }: { orderId: string; publishableKey: string; totalCents: number }) {
  const stripePromise = useMemo(() => getStripe(publishableKey), [publishableKey]);
  const [state, setState] = useState<{ kind: "idle" | "loading" } | { kind: "ready"; clientSecret: string } | { kind: "error"; message: string }>({
    kind: "idle",
  });

  async function start() {
    setState({ kind: "loading" });
    const result = await resumePaymentAction(orderId);
    setState(result.ok ? { kind: "ready", clientSecret: result.clientSecret } : { kind: "error", message: result.message });
  }

  if (state.kind === "ready") {
    return (
      <Elements stripe={stripePromise} options={{ clientSecret: state.clientSecret, appearance: stripeAppearance, fonts: stripeFonts }}>
        <RetryForm orderId={orderId} totalCents={totalCents} />
      </Elements>
    );
  }

  return (
    <div>
      {state.kind === "error" ? (
        <p role="alert" className="mb-3 text-sm font-semibold text-destructive">
          {state.message}{" "}
          <Link href="/checkout" className="underline underline-offset-2">
            Go to checkout
          </Link>
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void start()}
        disabled={state.kind === "loading"}
        className="focus-ring flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-5 text-base font-bold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
      >
        {state.kind === "loading" ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-5" aria-hidden="true" />}
        Try paying again
      </button>
    </div>
  );
}

function RetryForm({ orderId, totalCents }: { orderId: string; totalCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (submitting.current || !stripe || !elements) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/orders/${orderId}/confirmed` },
    });
    // Only reached on failure; success leaves for return_url.
    setError(
      confirmError.type === "card_error" || confirmError.type === "validation_error"
        ? (confirmError.message ?? "Your card was declined.")
        : "We couldn't take the payment. Please try again.",
    );
    submitting.current = false;
    setBusy(false);
  }

  return (
    <div>
      <PaymentElement options={{ layout: "tabs" }} onReady={() => setReady(true)} />
      {error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy || !ready}
        className="focus-ring mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-5 text-base font-bold text-white hover:bg-brand-teal-deep/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
      >
        {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : null}
        {busy ? "Processing…" : `Pay ${formatCents(totalCents)}`}
      </button>
    </div>
  );
}

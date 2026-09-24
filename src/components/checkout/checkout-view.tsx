"use client";

/**
 * Checkout. Everything on the page is a quote from the server
 * (quoteCheckoutAction): lines re-validated and re-priced, pickup options,
 * the promo result and the full breakdown. Nothing here is trusted by the
 * server; Pay sends the same choices to createCheckoutAction, which checks
 * them all again before it creates the order.
 *
 * Payment uses Stripe's deferred-intent flow: the Payment Element and the
 * Express Checkout Element render from the quoted amount, and the
 * PaymentIntent is only created when the customer taps Pay (or a wallet
 * button). One idempotency key per set of choices means a double tap, a
 * retry after a decline, or a network retry all land on the same order.
 */
import { Elements, ExpressCheckoutElement, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { StripeError, StripeExpressCheckoutElementConfirmEvent } from "@stripe/stripe-js";
import { CircleAlert, LoaderCircle, LockKeyhole, MapPin, ShoppingBag, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { OrderBreakdown } from "@/components/checkout/order-breakdown";
import { PickupPicker } from "@/components/checkout/pickup-picker";
import { PromoField } from "@/components/checkout/promo-field";
import { getStripe, stripeAppearance, stripeFonts } from "@/components/checkout/stripe";
import { TipPicker, parseTipText, type TipMode } from "@/components/checkout/tip-picker";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCartHydrated } from "@/lib/cart/hooks";
import { useCartStore, type CartLine } from "@/lib/cart/store";
import { createCheckoutAction, quoteCheckoutAction } from "@/lib/checkout/actions";
import type { PickupChoice, PickupOptions } from "@/lib/checkout/pickup";
import type { CheckoutInput, QuoteInput } from "@/lib/checkout/schemas";
import type { CheckoutQuote } from "@/lib/checkout/types";
import { newClientId } from "@/lib/client-id";
import { formatCents } from "@/lib/money";
import type { TipChoice } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/** Stripe's smallest USD charge; mirrors MINIMUM_CHARGE_CENTS on the server. */
const MINIMUM_CHARGE_CENTS = 50;
const REQUOTE_DELAY_MS = 300;

export interface CheckoutViewProps {
  publishableKey: string;
  defaultCupName: string;
  tipPresets: number[];
  defaultTipPercent: number;
  location: { id: string; name: string; pickupInstructions: string | null };
}

function toCartInput(line: CartLine) {
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

function defaultPickup(options: PickupOptions): PickupChoice | null {
  if (options.asap.available) return { type: "asap" };
  const slot = options.slots.find((s) => s.available);
  return slot ? { type: "scheduled", slot: slot.startsAt } : null;
}

export function CheckoutView(props: CheckoutViewProps) {
  const { tipPresets, defaultTipPercent, location } = props;
  const router = useRouter();
  const hydrated = useCartHydrated();
  const lines = useCartStore((s) => s.lines);
  const stripePromise = useMemo(() => getStripe(props.publishableKey), [props.publishableKey]);
  const ids = useId();

  const [pickup, setPickup] = useState<PickupChoice | null>(null);
  const [tipMode, setTipMode] = useState<TipMode>(
    tipPresets.includes(defaultTipPercent)
      ? { kind: "percent", percent: defaultTipPercent }
      : tipPresets.length > 0
        ? { kind: "percent", percent: tipPresets[0] }
        : { kind: "custom" },
  );
  const [customTipText, setCustomTipText] = useState("");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);
  const [cupName, setCupName] = useState(props.defaultCupName);
  const [notes, setNotes] = useState("");
  const [nonce, setNonce] = useState(0);
  const [quoted, setQuoted] = useState<{ key: string; quote: CheckoutQuote } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [pricesChanged, setPricesChanged] = useState(false);

  const customTipCents = tipMode.kind === "custom" ? parseTipText(customTipText) : 0;
  const tip: TipChoice | null =
    tipMode.kind === "percent"
      ? { kind: "percent", percent: tipMode.percent }
      : customTipCents === null
        ? null
        : { kind: "custom", cents: customTipCents };

  const cartInput = lines.map(toCartInput);
  const quoteInput: QuoteInput = { lines: cartInput, promoCode, tip: tip ?? { kind: "none" }, pickup };
  // One string for "what the quote is for": the effect below re-quotes when it changes.
  const quoteKey = `${nonce}:${JSON.stringify(quoteInput)}`;

  useEffect(() => {
    if (!hydrated) return;
    const input = JSON.parse(quoteKey.slice(quoteKey.indexOf(":") + 1)) as QuoteInput;
    if (input.lines.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      let result: Awaited<ReturnType<typeof quoteCheckoutAction>>;
      try {
        result = await quoteCheckoutAction(input);
      } catch {
        if (!cancelled) setQuoteError("We couldn't update your total. Check your connection and try again.");
        return;
      }
      if (cancelled) return;
      if ("signedOut" in result) {
        router.replace("/sign-in?next=/checkout");
        return;
      }
      if ("error" in result) {
        setQuoteError(result.error);
        return;
      }

      setQuoteError(null);
      setQuoted({ key: quoteKey, quote: result });
      setPickup((current) => current ?? defaultPickup(result.pickupOptions));

      // A code the server would not apply comes straight back off the order,
      // so it never blocks paying; the message stays until the next attempt.
      if (input.promoCode && result.promo) {
        if (result.promo.state === "applied") setPromoMessage(null);
        else {
          setPromoMessage(result.promo.message);
          setPromoCode((current) => (current === input.promoCode ? null : current));
        }
      }

      const changes = result.cart.lines.flatMap((line) =>
        line.issues
          .filter((issue) => issue.code === "price_changed" && issue.newPriceCents !== undefined)
          .map((issue) => ({ id: line.id, unitPriceCents: issue.newPriceCents!, summary: line.current?.summary })),
      );
      if (changes.length > 0) {
        setPricesChanged(true);
        useCartStore.getState().applyPrices(changes);
      }
    }, REQUOTE_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, quoteKey, router]);

  // Same choices, same key: a retry never makes a second order. Any change
  // to what is being bought starts a new attempt.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  function buildInput(): CheckoutInput {
    const base = { lines: cartInput, promoCode, tip: tip ?? { kind: "none" as const }, pickup: pickup!, cupName: cupName.trim(), notes: notes.trim() };
    const fingerprint = JSON.stringify([location.id, base]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: newClientId() };
    return { ...base, idempotencyKey: attempt.current.key };
  }

  if (!hydrated) {
    return (
      <div aria-busy="true" aria-label="Loading checkout" className="space-y-3">
        <Skeleton className="h-32 w-full rounded-3xl" />
        <Skeleton className="h-48 w-full rounded-3xl" />
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
        Add something from the menu to check out.
      </EmptyState>
    );
  }

  const quote = quoted?.quote ?? null;
  const fresh = quoted?.key === quoteKey;
  const breakdown = quote?.breakdown ?? null;
  const totalCents = breakdown?.totalCents ?? null;
  const checkedById = new Map((quote?.cart.lines ?? []).map((line) => [line.id, line]));
  const tipError = tipMode.kind === "custom" && customTipCents === null ? "Enter a tip in dollars and cents, like 3.50." : (quote?.tipError ?? null);
  const pickupError = quote?.pickup && !quote.pickup.ok ? quote.pickup.message : null;
  const cupNameError = cupName.trim() === "" ? "Tell us the name for your cup." : null;

  let blockedHint: string | null = null;
  if (!quote) blockedHint = "Working out your total…";
  else if (quote.cart.blocked && !quote.cart.location.canCheckout) blockedHint = quote.cart.location.blockedReason;
  else if (quote.cart.blocked) blockedHint = "Some items in your cart need attention.";
  else if (!pickup) blockedHint = "Choose a pickup time.";
  else if (pickupError) blockedHint = pickupError;
  else if (tipError) blockedHint = tipError;
  else if (cupNameError) blockedHint = cupNameError;
  else if (totalCents !== null && totalCents < MINIMUM_CHARGE_CENTS) blockedHint = `Card payments start at ${formatCents(MINIMUM_CHARGE_CENTS)}.`;
  else if (quote.problems.length > 0 && fresh) blockedHint = quote.problems[0];
  const canPay = Boolean(quote && fresh && !blockedHint && totalCents !== null);

  return (
    <div className="space-y-5">
      <Section title="Pickup" icon={<MapPin aria-hidden="true" />}>
        <p className="font-semibold">{location.name}</p>
        {location.pickupInstructions ? <p className="text-sm text-muted-foreground">{location.pickupInstructions}</p> : null}
        <div className="mt-3">
          {quote ? (
            <PickupPicker options={quote.pickupOptions} value={pickup} error={pickupError} onChange={setPickup} />
          ) : (
            <Skeleton className="h-28 w-full rounded-2xl" />
          )}
        </div>
      </Section>

      <Section title="Your order" action={<Link href="/cart" className="focus-ring rounded-full px-3 py-2 text-sm font-semibold text-brand-teal-deep hover:bg-brand-teal-soft">Edit cart</Link>}>
        {quote?.cart.blocked && quote.cart.location.canCheckout ? (
          <Notice title="Some items need attention">
            <Link href="/cart" className="font-semibold underline underline-offset-2">
              Review your cart
            </Link>{" "}
            to fix or remove them.
          </Notice>
        ) : null}
        {quote && !quote.cart.location.canCheckout ? <Notice title="Checkout isn't available right now">{quote.cart.location.blockedReason}</Notice> : null}
        {pricesChanged ? (
          <p role="status" className="mb-3 rounded-xl bg-muted px-3 py-2 text-sm">
            Some prices changed since you added these items. The totals below are up to date.
          </p>
        ) : null}
        <ul className="divide-y">
          {lines.map((line) => {
            const checked = checkedById.get(line.id);
            const summary = checked?.current?.summary ?? line.summary;
            const blocking = checked?.issues.some((i) => i.blocking);
            return (
              <li key={line.id} className="flex justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="tabular">{line.quantity}×</span> {checked?.current?.productName ?? line.productName}
                  </p>
                  {summary.length > 0 ? <p className="text-sm text-muted-foreground">{summary.join(" · ")}</p> : null}
                  {line.specialInstructions ? <p className="text-sm italic">“{line.specialInstructions}”</p> : null}
                  {blocking ? (
                    <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-destructive">
                      <CircleAlert className="size-4" aria-hidden="true" />
                      {checked?.issues.find((i) => i.blocking)?.message}
                    </p>
                  ) : null}
                </div>
                <p className="tabular shrink-0 font-semibold">
                  {formatCents(checked?.current?.lineTotalCents ?? line.unitPriceCents * line.quantity)}
                </p>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Details">
        <div className="space-y-4">
          <div>
            <label htmlFor={`${ids}-cup`} className="text-sm font-semibold">
              Name for your cup
            </label>
            <input
              id={`${ids}-cup`}
              value={cupName}
              onChange={(event) => setCupName(event.target.value)}
              maxLength={30}
              autoComplete="given-name"
              aria-invalid={cupNameError ? true : undefined}
              aria-describedby={`${ids}-cup-hint`}
              className={cn("focus-ring mt-1 h-11 w-full rounded-xl border bg-card px-3 text-base", cupNameError && "border-destructive")}
            />
            <p id={`${ids}-cup-hint`} className={cn("mt-1 text-sm", cupNameError ? "font-semibold text-destructive" : "text-muted-foreground")}>
              {cupNameError ?? "What the barista calls out."}
            </p>
          </div>
          <div>
            <label htmlFor={`${ids}-notes`} className="text-sm font-semibold">
              Notes for the barista <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id={`${ids}-notes`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={200}
              rows={2}
              className="focus-ring mt-1 w-full rounded-xl border bg-card px-3 py-2 text-base"
            />
          </div>
          <PromoField
            applied={
              quote?.promo?.state === "applied" && promoCode === quote.promo.code
                ? { code: quote.promo.code, discountCents: quote.promo.discountCents }
                : null
            }
            pending={promoCode !== null && !fresh ? promoCode : null}
            message={promoMessage}
            onApply={(code) => {
              setPromoMessage(null);
              setPromoCode(code.toUpperCase());
            }}
            onRemove={() => {
              setPromoCode(null);
              setPromoMessage(null);
            }}
          />
        </div>
      </Section>

      <Section title="Tip">
        <TipPicker
          presets={tipPresets}
          value={tipMode}
          customText={customTipText}
          taxableCents={breakdown?.taxableCents ?? null}
          error={tipError}
          onChange={setTipMode}
          onCustomTextChange={setCustomTipText}
        />
      </Section>

      <Section title="Total">
        {breakdown ? (
          <div aria-busy={!fresh}>
            <OrderBreakdown values={{ ...breakdown, promoCode: quote?.promo?.state === "applied" ? quote.promo.code : null }} />
            {!fresh ? <p className="mt-2 text-sm text-muted-foreground">Updating…</p> : null}
          </div>
        ) : quoteError ? null : (
          <Skeleton className="h-28 w-full rounded-2xl" />
        )}
        {quoteError ? (
          <p role="alert" className="mt-2 text-sm font-semibold text-destructive">
            {quoteError}{" "}
            <button type="button" onClick={() => setNonce((n) => n + 1)} className="underline underline-offset-2">
              Try again
            </button>
          </p>
        ) : null}
      </Section>

      <Section title="Payment" icon={<LockKeyhole aria-hidden="true" />}>
        <Elements
          stripe={stripePromise}
          options={{
            mode: "payment",
            currency: "usd",
            // Elements needs a chargeable amount before the first quote lands.
            amount: Math.max(totalCents ?? MINIMUM_CHARGE_CENTS, MINIMUM_CHARGE_CENTS),
            appearance: stripeAppearance,
            fonts: stripeFonts,
          }}
        >
          <PaymentPanel
            totalCents={totalCents}
            canPay={canPay}
            blockedHint={blockedHint}
            buildInput={buildInput}
            resetAttempt={() => {
              attempt.current = null;
            }}
            onQuote={(next) => setQuoted({ key: quoteKey, quote: next })}
            requote={() => setNonce((n) => n + 1)}
          />
        </Elements>
      </Section>
    </div>
  );
}

function paymentErrorMessage(error: StripeError): string {
  if (error.type === "card_error" || error.type === "validation_error") {
    return error.message ?? "Your card was declined. Try another card.";
  }
  return "We couldn't take the payment. Please try again.";
}

/** Inside <Elements>: the wallets, the card form and the Pay button. */
function PaymentPanel({
  totalCents,
  canPay,
  blockedHint,
  buildInput,
  resetAttempt,
  onQuote,
  requote,
}: {
  totalCents: number | null;
  canPay: boolean;
  blockedHint: string | null;
  buildInput: () => CheckoutInput;
  resetAttempt: () => void;
  onQuote: (quote: CheckoutQuote) => void;
  requote: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const setPendingOrder = useCartStore((s) => s.setPendingOrder);

  // A ref, not state: two taps in the same frame both see it.
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expressShown, setExpressShown] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);

  async function pay(express?: StripeExpressCheckoutElementConfirmEvent) {
    if (submitting.current || !stripe || !elements) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    let leaving = false;

    const fail = (message: string) => {
      setError(message);
      express?.paymentFailed({ reason: "fail" });
    };

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        fail(submitError.message ?? "Check your payment details.");
        return;
      }

      let result = await createCheckoutAction(buildInput());
      if (!result.ok && result.code === "expired") {
        // The last attempt's order was cancelled: this tap starts a fresh one.
        resetAttempt();
        result = await createCheckoutAction(buildInput());
      }
      if (!result.ok) {
        if (result.code === "signed_out") {
          leaving = true;
          router.replace("/sign-in?next=/checkout");
          return;
        }
        if (result.code === "changed") resetAttempt();
        if (result.quote) onQuote(result.quote);
        fail(result.message);
        return;
      }

      setPendingOrder(result.orderId);
      if ("alreadyPaid" in result) {
        leaving = true;
        router.push(`/orders/${result.orderId}/confirmed`);
        return;
      }
      if (result.totalCents !== totalCents) {
        // Something changed between the quote and the order; never charge a
        // different amount from the one on the button.
        requote();
        fail(`Your total is now ${formatCents(result.totalCents)}. Check your order and tap Pay again.`);
        return;
      }

      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        clientSecret: result.clientSecret,
        confirmParams: { return_url: `${window.location.origin}/orders/${result.orderId}/confirmed` },
      });
      // Only reached on failure: success (and 3-D Secure) leaves for return_url.
      if (confirmError) fail(paymentErrorMessage(confirmError));
      else leaving = true;
    } catch (caught) {
      console.error("Checkout failed", caught);
      fail("Something went wrong. Please try again.");
    } finally {
      if (!leaving) {
        submitting.current = false;
        setBusy(false);
      }
    }
  }

  const disabled = !canPay || busy || !stripe || !elements || !paymentReady;

  return (
    <div>
      <div className={cn(!expressShown && "hidden")}>
        <ExpressCheckoutElement
          options={{ buttonType: { applePay: "order", googlePay: "order" }, buttonHeight: 48 }}
          onReady={({ availablePaymentMethods }) => setExpressShown(Boolean(availablePaymentMethods))}
          onClick={(event) => {
            if (!canPay || submitting.current) {
              event.reject();
              if (blockedHint) setError(blockedHint);
              return;
            }
            event.resolve();
          }}
          onConfirm={(event) => void pay(event)}
        />
        <p className="my-4 flex items-center gap-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <span className="h-px flex-1 bg-border" />
          or pay by card
          <span className="h-px flex-1 bg-border" />
        </p>
      </div>

      <PaymentElement options={{ layout: "tabs" }} onReady={() => setPaymentReady(true)} />

      {error ? (
        <p role="alert" className="mt-4 flex items-start gap-1.5 text-sm font-semibold text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void pay()}
        disabled={disabled}
        aria-describedby={blockedHint && !busy ? "pay-hint" : undefined}
        className="focus-ring mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep px-5 text-base font-bold text-white hover:bg-brand-teal-deep/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
      >
        {busy ? (
          <>
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
            Processing…
          </>
        ) : totalCents !== null ? (
          `Pay ${formatCents(totalCents)}`
        ) : (
          "Pay"
        )}
      </button>
      {blockedHint && !busy ? (
        <p id="pay-hint" className="mt-2 text-center text-sm text-muted-foreground">
          {blockedHint}
        </p>
      ) : null}
      <p className="mt-3 text-center text-xs text-muted-foreground">Payments are processed securely by Stripe.</p>
    </div>
  );
}

function Section({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-3xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={id} className="flex items-center gap-2 text-lg font-bold">
          {icon ? <span className="text-brand-teal-deep [&_svg]:size-5">{icon}</span> : null}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="mb-3 flex gap-3 rounded-2xl border border-warning/30 bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))] p-3 text-sm">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
      <div>
        <p className="font-bold">{title}</p>
        <div className="text-foreground/80">{children}</div>
      </div>
    </div>
  );
}

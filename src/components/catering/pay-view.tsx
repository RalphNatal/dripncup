"use client";

/**
 * Paying for a catering quote with Stripe's Payment Element, like checkout.
 * The PaymentIntent is the quote's own (one per quote version), fetched for
 * the owner only, at the quote's stored total. After paying, the page waits
 * for the server to confirm: the webhook normally, the reconcile fallback
 * (the server reading the payment from Stripe) if the webhook is slow.
 */
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CircleAlert, LoaderCircle, PartyPopper } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { getStripe, stripeAppearance, stripeFonts } from "@/components/checkout/stripe";
import { cateringPaymentStatusAction, reconcileCateringPaymentAction, startCateringPaymentAction } from "@/lib/catering/actions";
import { formatCents } from "@/lib/money";

const POLL_MS = 1500;
const RECONCILE_AFTER_MS = 6000;

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; clientSecret: string }
  | { kind: "confirming" }
  | { kind: "confirmed" }
  | { kind: "error"; message: string };

function PayForm({ requestId, totalCents, onPaid }: { requestId: string; totalCents: number; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: new URL(`/catering/${requestId}/pay`, window.location.origin).toString() },
      });
      if (confirmError) {
        setError(confirmError.message ?? "Your payment didn't go through. Please try again.");
        return;
      }
      if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) onPaid();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!stripe || busy}
        className="focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep text-base font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
      >
        {busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : null}
        {busy ? "Processing…" : `Pay ${formatCents(totalCents)}`}
      </button>
    </form>
  );
}

export function CateringPayView({
  requestId,
  quoteId,
  totalCents,
  publishableKey,
  returning,
}: {
  requestId: string;
  quoteId: string;
  totalCents: number;
  publishableKey: string | null;
  /** Back from a redirect (3-D Secure): skip straight to waiting. */
  returning: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(() => (returning ? { kind: "confirming" } : { kind: "loading" }));

  // The quote's PaymentIntent, for the owner.
  useEffect(() => {
    if (phase.kind !== "loading") return;
    let cancelled = false;
    void startCateringPaymentAction({ requestId, quoteId })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setPhase({ kind: "ready", clientSecret: result.clientSecret });
        else if (result.alreadyPaying) setPhase({ kind: "confirming" });
        else setPhase({ kind: "error", message: result.message });
      })
      .catch(() => !cancelled && setPhase({ kind: "error", message: "We couldn't start the payment. Please refresh and try again." }));
    return () => {
      cancelled = true;
    };
  }, [phase.kind, requestId, quoteId]);

  // Waiting for the server to confirm it.
  useEffect(() => {
    if (phase.kind !== "confirming") return;
    const started = Date.now();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (Date.now() - started >= RECONCILE_AFTER_MS) await reconcileCateringPaymentAction(requestId).catch(() => null);
      const state = await cateringPaymentStatusAction(requestId).catch(() => null);
      if (stopped) return;
      if (state?.status === "confirmed" || state?.status === "fulfilled") return setPhase({ kind: "confirmed" });
      if (state?.status === "cancelled") {
        return setPhase({ kind: "error", message: "This request was cancelled while you were paying; any payment taken is refunded in full." });
      }
      if (state?.failure) return setPhase({ kind: "error", message: state.failure });
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [phase.kind, requestId]);

  if (phase.kind === "confirmed") {
    return (
      <section className="rounded-3xl border-2 border-brand-teal-deep bg-card p-6 text-center" aria-live="polite" data-testid="catering-paid">
        <PartyPopper className="mx-auto size-10 text-brand-magenta-deep" aria-hidden="true" />
        <h2 className="mt-3 text-2xl font-extrabold">Mahalo! You&apos;re confirmed.</h2>
        <p className="mt-1 text-muted-foreground">Your receipt is on its way to your inbox. We&apos;ll remind you the day before your event.</p>
        <Link
          href={`/account/catering/${requestId}`}
          className="focus-ring mt-5 inline-flex min-h-12 items-center rounded-full bg-brand-teal-deep px-6 font-semibold text-white hover:bg-brand-teal-deep/90"
        >
          View your request
        </Link>
      </section>
    );
  }

  if (phase.kind === "confirming") {
    return (
      <div className="py-10 text-center" role="status" aria-live="polite">
        <LoaderCircle className="mx-auto size-10 animate-spin text-brand-teal-deep" aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-extrabold">Confirming your payment…</h2>
        <p className="mt-1 text-muted-foreground">This usually takes a few seconds. Please keep this page open.</p>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="space-y-4 text-center">
        <p className="flex items-start justify-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {phase.message}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => setPhase({ kind: "loading" })} className="focus-ring min-h-11 rounded-full border px-5 font-semibold hover:bg-muted">
            Try again
          </button>
          <Link href={`/account/catering/${requestId}`} className="focus-ring inline-flex min-h-11 items-center rounded-full border px-5 font-semibold hover:bg-muted">
            Back to your request
          </Link>
        </div>
      </div>
    );
  }

  if (!publishableKey) return <p className="text-sm">Card payments aren&apos;t set up yet.</p>;

  return phase.kind === "loading" ? (
    <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground" role="status">
      <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
      Preparing secure payment…
    </div>
  ) : (
    <Elements stripe={getStripe(publishableKey)} options={{ clientSecret: phase.clientSecret, appearance: stripeAppearance, fonts: stripeFonts }}>
      <PayForm requestId={requestId} totalCents={totalCents} onPaid={() => setPhase({ kind: "confirming" })} />
    </Elements>
  );
}

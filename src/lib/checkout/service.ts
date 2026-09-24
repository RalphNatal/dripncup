import "server-only";

/**
 * Checkout, server side. Two entry points share one preparation step:
 *
 *   quote()           what the checkout page shows: re-validated lines,
 *                     pickup options, promo result, the full breakdown
 *   createCheckout()  the same checks again, then the pending order, its
 *                     snapshot lines and the PaymentIntent
 *
 * Nothing the browser sends is trusted: the location comes from the cookie,
 * prices from the live catalogue, the promo from the database, and the total
 * from calculateOrderTotal.
 */
import { createHash } from "node:crypto";

import { getCurrentProfile } from "@/lib/auth/dal";
import { evaluateCart, type EvaluatedCart } from "@/lib/checkout/cart-check";
import { loadLocationSnapshot, loadPickupContext, type LocationRecord } from "@/lib/checkout/location-context";
import { getPickupOptions, resolvePickupChoice, type PickupOptions, type ResolvedPickup } from "@/lib/checkout/pickup";
import {
  checkoutInputSchema,
  quoteInputSchema,
  type CartLineInput,
  type CheckoutInput,
  type QuoteInput,
} from "@/lib/checkout/schemas";
import { getCheckoutSettings, type CheckoutSettings } from "@/lib/checkout/settings";
import type { CartCheck, CartLocation, CheckoutQuote, CreateCheckoutResult, PromoStatus } from "@/lib/checkout/types";
import { getStorefront, type LocationView } from "@/lib/locations/storefront";
import { formatCents } from "@/lib/money";
import { paymentProvider } from "@/lib/payments";
import {
  PROMO_NOT_APPLICABLE_MESSAGE,
  calculateOrderTotal,
  selectionKey,
  type OrderTotalResult,
  type PromoRule,
  type TipResult,
} from "@/lib/pricing";
import { LIMITS, hasRoomUserAndIp, hitUserAndIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

/** Stripe's smallest USD charge. */
export const MINIMUM_CHARGE_CENTS = 50;

// ---------------------------------------------------------------------------
// The cart page (guests too): lines and location only.
// ---------------------------------------------------------------------------

function cartLocation(view: LocationView): CartLocation {
  // Closed still allows scheduling for the next open day; paused and a pop-up
  // outside its window allow nothing.
  const blocked = view.status.kind === "paused" || view.status.kind === "event";
  return {
    id: view.id,
    name: view.name,
    statusLabel: view.status.label,
    canCheckout: !blocked,
    blockedReason: blocked ? view.status.unavailableReason : null,
  };
}

async function selectedLocation(): Promise<LocationView> {
  const { selected } = await getStorefront();
  if (!selected) throw new Error("No pickup location is set up.");
  return selected;
}

export async function checkCart(lines: CartLineInput[]): Promise<CartCheck> {
  const view = await selectedLocation();
  const cart = await evaluateCart(lines, view);
  const location = cartLocation(view);
  return {
    lines: cart.lines,
    location,
    subtotalCents: cart.subtotalCents,
    blocked: cart.blocked || !location.canCheckout,
  };
}

// ---------------------------------------------------------------------------
// Checkout: quote and create.
// ---------------------------------------------------------------------------

interface Prepared {
  now: Date;
  view: LocationView;
  location: LocationRecord | null;
  settings: CheckoutSettings;
  cart: EvaluatedCart;
  pickupOptions: PickupOptions;
  pickup: ResolvedPickup | null;
  pickupError: string | null;
  promoRule: PromoRule | null;
  promo: PromoStatus | null;
  totals: OrderTotalResult | null;
  tipError: string | null;
  problems: string[];
}

function tipMessage(result: Exclude<TipResult, { ok: true }>): string {
  switch (result.code) {
    case "unknown_preset":
      return "Choose one of the tip options.";
    case "invalid_amount":
      return "Enter a tip in dollars and cents.";
    case "too_high":
      return `Tips on this order can be up to ${formatCents(result.maxCents)}.`;
  }
}

async function loadPromo(code: string, userId: string, idempotencyKey?: string) {
  const { data, error } = await createAdminClient().rpc("get_promo_for_checkout", {
    p_code: code,
    p_user_id: userId,
    p_exclude_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`Checkout: could not look up the promo (${error.message})`);
  if (!data || typeof data !== "object") return { rule: null, uses: 0 };

  const row = data as Record<string, unknown>;
  const rule: PromoRule = {
    id: String(row.id),
    code: String(row.code),
    type: row.type === "fixed" ? "fixed" : "percent",
    percent: row.percent === null ? null : Number(row.percent),
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    minSpendCents: Number(row.min_spend_cents ?? 0),
    maxDiscountCents: row.max_discount_cents === null ? null : Number(row.max_discount_cents),
    usageLimit: row.usage_limit === null ? null : Number(row.usage_limit),
    perUserLimit: row.per_user_limit === null ? null : Number(row.per_user_limit),
    timesUsed: Number(row.times_used ?? 0),
    startsAt: String(row.starts_at),
    endsAt: row.ends_at === null ? null : String(row.ends_at),
    isActive: row.is_active === true,
  };
  return { rule, uses: Number(row.user_uses ?? 0) };
}

async function prepare(
  input: { lines: CartLineInput[]; promoCode?: string | null; tip: CheckoutInput["tip"]; pickup: CheckoutInput["pickup"] | null },
  userId: string,
  idempotencyKey?: string,
): Promise<Prepared> {
  const now = new Date();
  const view = await selectedLocation();
  const [snapshot, settings] = await Promise.all([loadLocationSnapshot(view.id, now), getCheckoutSettings()]);

  const cart = await evaluateCart(input.lines, view, now);
  const problems: string[] = [];

  let pickupOptions: PickupOptions;
  if (snapshot) {
    pickupOptions = getPickupOptions(await loadPickupContext(snapshot, settings, now, idempotencyKey));
  } else {
    pickupOptions = {
      canCheckout: false,
      blockedReason: `${view.name} isn't taking orders.`,
      asap: { available: false, readyAt: null, unavailableReason: null },
      slotDate: null,
      slots: [],
    };
  }

  let pickup: ResolvedPickup | null = null;
  let pickupError: string | null = null;
  if (input.pickup) {
    const resolved = resolvePickupChoice(input.pickup, pickupOptions);
    if (resolved.ok) pickup = resolved.pickup;
    else pickupError = resolved.message;
  }

  // Promo: refuse outright while over the failure limit, so a guesser cannot
  // keep testing codes; count every "can't be applied" answer.
  let promoRule: PromoRule | null = null;
  let promoUses = 0;
  let promo: PromoStatus | null = null;
  const code = input.promoCode ?? null;
  if (code) {
    if (!(await hasRoomUserAndIp(LIMITS.promoFailuresPerUser, LIMITS.promoFailuresPerIp, userId))) {
      promo = { code, state: "rate_limited", discountCents: 0, message: "Too many code attempts. Try again in a few minutes." };
    } else {
      ({ rule: promoRule, uses: promoUses } = await loadPromo(code, userId, idempotencyKey));
    }
  }

  const totals =
    cart.orderLines.length > 0
      ? calculateOrderTotal({
          lines: cart.orderLines,
          promo: promoRule,
          promoCustomerUses: promoUses,
          taxRate: settings.taxRate,
          tip: input.tip,
          tipPolicy: settings.tipPolicy,
          now,
        })
      : null;

  // Judged only once the order itself prices (lines valid, tip valid). A code
  // with no promo behind it is answered exactly like one that failed a rule.
  if (code && !promo && totals?.ok) {
    const evaluation = totals.promo;
    if (evaluation?.ok) {
      promo = { code, state: "applied", discountCents: totals.breakdown.promoDiscountCents, message: null };
    } else if (evaluation?.reason === "min_spend") {
      promo = {
        code,
        state: "min_spend",
        discountCents: 0,
        message: `Spend ${formatCents(evaluation.minSpendCents)} or more to use this code.`,
      };
    } else {
      await hitUserAndIp(LIMITS.promoFailuresPerUser, LIMITS.promoFailuresPerIp, userId);
      promo = { code, state: "invalid", discountCents: 0, message: PROMO_NOT_APPLICABLE_MESSAGE };
    }
  }

  const tipError = totals && !totals.ok && totals.reason === "invalid_tip" ? tipMessage(totals.tip) : null;

  if (input.lines.length === 0) problems.push("Your cart is empty.");
  else if (cart.blocked) problems.push("Some items in your cart need attention before you can check out.");
  if (!pickupOptions.canCheckout && pickupOptions.blockedReason) problems.push(pickupOptions.blockedReason);
  if (pickupError) problems.push(pickupError);
  if (tipError) problems.push(tipError);
  if (promo && promo.state !== "applied" && promo.message) problems.push(promo.message);

  return {
    now,
    view,
    location: snapshot?.location ?? null,
    settings,
    cart,
    pickupOptions,
    pickup,
    pickupError,
    promoRule: promo?.state === "applied" ? promoRule : null,
    promo,
    totals,
    tipError,
    problems,
  };
}

function toQuote(prepared: Prepared): CheckoutQuote {
  const location = cartLocation(prepared.view);
  return {
    cart: {
      lines: prepared.cart.lines,
      location,
      subtotalCents: prepared.cart.subtotalCents,
      blocked: prepared.cart.blocked || !location.canCheckout,
    },
    pickupOptions: prepared.pickupOptions,
    pickup: prepared.pickup
      ? { ok: true, readyAt: prepared.pickup.estimatedReadyAt.toISOString() }
      : prepared.pickupError
        ? { ok: false, message: prepared.pickupError }
        : null,
    promo: prepared.promo,
    breakdown: prepared.totals?.ok ? prepared.totals.breakdown : null,
    tipError: prepared.tipError,
    problems: prepared.problems,
  };
}

export async function quote(raw: QuoteInput): Promise<CheckoutQuote | { signedOut: true }> {
  const profile = await getCurrentProfile();
  if (!profile) return { signedOut: true };
  const input = quoteInputSchema.parse(raw);
  return toQuote(await prepare(input, profile.id));
}

/**
 * The same idempotency key must mean the same checkout. Hashing what was
 * submitted (not what the browser claims about it) lets a double-tapped Pay
 * return the first order while a key reused for a changed cart is refused.
 */
function fingerprint(input: ReturnType<typeof checkoutInputSchema.parse>, locationId: string): string {
  const canonical = {
    locationId,
    lines: input.lines.map((l) => [l.productId, l.sizeId, selectionKey(l.selection), l.specialInstructions.trim(), l.quantity]),
    promo: input.promoCode ?? null,
    tip: input.tip,
    pickup: input.pickup,
    cupName: input.cupName,
    notes: input.notes,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

type OrderForPayment = {
  id: string;
  order_number: string;
  total_cents: number;
  tip_cents: number;
  customer_email: string | null;
  idempotency_key: string;
};

/** Returns the order's PaymentIntent client secret, creating the intent once. */
async function ensurePayment(order: OrderForPayment): Promise<CreateCheckoutResult> {
  const db = createAdminClient();
  const provider = paymentProvider();

  const { data: existing } = await db
    .from("payments")
    .select("provider_payment_intent_id")
    .eq("order_id", order.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  try {
    const payment = existing?.provider_payment_intent_id
      ? await provider.retrievePayment(existing.provider_payment_intent_id)
      : await provider.createPayment({
          orderId: order.id,
          orderNumber: order.order_number,
          amountCents: order.total_cents,
          currency: "usd",
          idempotencyKey: order.idempotency_key,
          customerEmail: order.customer_email,
          description: `Drincup Cafe order ${order.order_number}`,
        });

    if (!existing) {
      await db.from("payments").upsert(
        {
          order_id: order.id,
          provider: provider.name,
          provider_payment_intent_id: payment.id,
          status: "requires_payment",
          amount_cents: order.total_cents,
          tip_cents: order.tip_cents,
          raw: { id: payment.id, status: payment.status, amount: payment.amountCents },
        },
        { onConflict: "provider_payment_intent_id", ignoreDuplicates: true },
      );
    }

    if (payment.status === "succeeded" || payment.status === "processing") {
      return { ok: true, orderId: order.id, alreadyPaid: true };
    }
    if (payment.status === "canceled") {
      return { ok: false, code: "expired", message: "This checkout expired. Please try again." };
    }
    return {
      ok: true,
      orderId: order.id,
      orderNumber: order.order_number,
      clientSecret: payment.clientSecret,
      totalCents: order.total_cents,
    };
  } catch (error) {
    console.error(`Order ${order.id}: could not set up payment`, error);
    return { ok: false, code: "payment_setup_failed", message: "We couldn't start the payment. Please try again." };
  }
}

export async function createCheckout(raw: CheckoutInput): Promise<CreateCheckoutResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, code: "signed_out", message: "Sign in to check out." };

  const parsed = checkoutInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Please check your order." };
  }
  const input = parsed.data;

  if (!(await hitUserAndIp(LIMITS.checkoutPerUser, LIMITS.checkoutPerIp, profile.id))) {
    return { ok: false, code: "rate_limited", message: "Too many checkout attempts. Please wait a few minutes." };
  }

  const db = createAdminClient();
  const view = await selectedLocation();
  const print = fingerprint(input, view.id);
  const orderColumns = "id, user_id, status, checkout_fingerprint, order_number, total_cents, tip_cents, customer_email, idempotency_key";

  // A retry of the same attempt (double tap, network retry, declined card).
  const { data: existing } = await db.from("orders").select(orderColumns).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing) {
    if (existing.user_id !== profile.id) return { ok: false, code: "invalid", message: "This checkout can't be resumed." };
    if (existing.checkout_fingerprint !== print) {
      return { ok: false, code: "changed", message: "Your order changed. Review it and pay again." };
    }
    if (existing.status !== "pending_payment") {
      return existing.status === "cancelled" || existing.status === "refunded"
        ? { ok: false, code: "expired", message: "This checkout was cancelled. Please try again." }
        : { ok: true, orderId: existing.id, alreadyPaid: true };
    }
    return ensurePayment(existing);
  }

  const prepared = await prepare(input, profile.id, input.idempotencyKey);
  const totals = prepared.totals;
  if (prepared.problems.length > 0 || !prepared.pickup || !totals?.ok || !prepared.location) {
    return {
      ok: false,
      code: "invalid",
      message: prepared.problems[0] ?? "Please review your order.",
      quote: toQuote(prepared),
    };
  }
  if (totals.breakdown.totalCents < MINIMUM_CHARGE_CENTS) {
    return {
      ok: false,
      code: "minimum_charge",
      message: `Card payments start at ${formatCents(MINIMUM_CHARGE_CENTS)}.`,
      quote: toQuote(prepared),
    };
  }

  const { breakdown } = totals;
  const { data: created, error } = await db.rpc("create_checkout_order", {
    p_order: {
      user_id: profile.id,
      location_id: prepared.location.id,
      pickup_type: prepared.pickup.pickupType,
      scheduled_for: prepared.pickup.scheduledFor?.toISOString() ?? null,
      estimated_ready_at: prepared.pickup.estimatedReadyAt.toISOString(),
      subtotal_cents: breakdown.subtotalCents,
      discount_cents: breakdown.discountCents,
      taxable_base_cents: breakdown.taxableCents,
      tax_rate: breakdown.taxRate,
      tax_cents: breakdown.taxCents,
      tip_cents: breakdown.tipCents,
      total_cents: breakdown.totalCents,
      promo_id: prepared.promoRule?.id ?? null,
      promo_code: prepared.promoRule?.code ?? null,
      customer_first_name: input.cupName,
      customer_phone: profile.phone,
      customer_email: profile.email,
      notes: input.notes || null,
      idempotency_key: input.idempotencyKey,
      checkout_fingerprint: print,
    },
    p_items: totals.lines.map((line) => ({
      product_id: line.product.id,
      product_size_id: line.size?.id ?? null,
      product_name: line.product.name,
      size_name: line.size?.name ?? null,
      modifiers: line.modifiers.map((m) => ({
        group_id: m.groupId,
        group_name: m.groupName,
        option_id: m.optionId,
        option_name: m.optionName,
        quantity: m.quantity,
        price_delta_cents: m.priceDeltaCents,
        charge_per_quantity: m.chargePerQuantity,
        quantity_unit: m.quantityUnit,
      })),
      base_price_cents: line.basePriceCents,
      unit_price_cents: line.unitPriceCents,
      quantity: line.quantity,
      line_total_cents: line.lineTotalCents,
      special_instructions: line.specialInstructions,
    })),
  });

  const orderId = created?.[0]?.order_id;
  if (error || !orderId) {
    console.error("createCheckout: could not create the order", error);
    return { ok: false, code: "invalid", message: "We couldn't place your order. Please try again." };
  }

  const { data: order } = await db.from("orders").select(orderColumns).eq("id", orderId).single();
  if (!order) return { ok: false, code: "invalid", message: "We couldn't place your order. Please try again." };
  // Lost a race with an identical request: it is the same checkout either way.
  if (order.checkout_fingerprint !== print) {
    return { ok: false, code: "changed", message: "Your order changed. Review it and pay again." };
  }
  return ensurePayment(order);
}

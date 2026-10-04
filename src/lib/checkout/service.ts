import "server-only";

/**
 * Checkout, server side. Two entry points share one preparation step:
 *
 *   quote()           what the checkout page shows: re-validated lines,
 *                     pickup options, promo and reward results, the full
 *                     breakdown and the points the order earns
 *   createCheckout()  the same checks again, then the pending order, its
 *                     snapshot lines, rewards and points reservation, and
 *                     the PaymentIntent (or, for a $0.00 order a reward paid
 *                     for in full, the order placed straight away)
 *
 * Nothing the browser sends is trusted: the location comes from the cookie,
 * prices from the live catalogue, the promo and rewards from the database,
 * the points balance from the ledger, and the total from calculateOrderTotal.
 */
import { createHash, randomUUID } from "node:crypto";

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
import type { CartCheck, CartLocation, CheckoutQuote, CheckoutRewards, CreateCheckoutResult, PromoStatus } from "@/lib/checkout/types";
import { getStorefront, type LocationView } from "@/lib/locations/storefront";
import { formatCents } from "@/lib/money";
import { cancelUnpaidCheckout } from "@/lib/orders/expiry";
import { paymentProvider } from "@/lib/payments";
import {
  PROMO_NOT_APPLICABLE_MESSAGE,
  calculateOrderTotal,
  pointsEligibleCents,
  pointsForOrder,
  selectionKey,
  type OrderTotalResult,
  type PromoRule,
  type TipResult,
} from "@/lib/pricing";
import { LIMITS, hasRoomUserAndIp, hitUserAndIp } from "@/lib/rate-limit";
import { appliedRewards, resolveRewardChoices, rewardOptions } from "@/lib/rewards/checkout";
import type { RewardTier } from "@/lib/rewards/model";
import { getHeldPoints, getRewardsSettings, getRewardTiers } from "@/lib/rewards/queries";
import { createAdminClient } from "@/lib/supabase/admin";

/** Stripe's smallest USD charge. */
export const MINIMUM_CHARGE_CENTS = 50;

/** Why an earlier attempt from the same browser was cancelled. */
export const REPLACED_REASON = "Replaced by a newer checkout before it was paid.";

function minimumChargeMessage(rewardApplied: boolean): string {
  const minimum = formatCents(MINIMUM_CHARGE_CENTS);
  return rewardApplied
    ? `Card payments start at ${minimum}. Add a tip or another item to pay the rest.`
    : `Card payments start at ${minimum}.`;
}

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
  /** The rewards that were priced, aligned with `totals.rewards`. */
  rewardTiers: RewardTier[];
  rewards: CheckoutRewards;
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

/** The ledger balance, read fresh (a replaced checkout may just have returned points). */
async function loadBalance(userId: string): Promise<number> {
  const { data, error } = await createAdminClient().from("profiles").select("loyalty_points").eq("id", userId).single();
  if (error) throw new Error(`Checkout: could not read the points balance (${error.message})`);
  return data.loyalty_points;
}

interface PrepareInput {
  lines: CartLineInput[];
  promoCode?: string | null;
  tip: CheckoutInput["tip"];
  pickup: CheckoutInput["pickup"] | null;
  rewards?: { rewardId: string; lineId?: string | null }[];
  heldByKeys?: string[];
}

async function prepare(input: PrepareInput, userId: string, idempotencyKey?: string): Promise<Prepared> {
  const now = new Date();
  const view = await selectedLocation();
  const ownKeys = [...(input.heldByKeys ?? []), ...(idempotencyKey ? [idempotencyKey] : [])];
  const [snapshot, settings, rewardsSettings, tiers, balance, held] = await Promise.all([
    loadLocationSnapshot(view.id, now),
    getCheckoutSettings(),
    getRewardsSettings(),
    getRewardTiers(),
    loadBalance(userId),
    getHeldPoints(userId, ownKeys),
  ]);
  // Points this browser's own unpaid attempt holds are the customer's to use here.
  const spendable = balance + held.ownPoints;

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

  const choices = resolveRewardChoices(input.rewards ?? [], tiers, {
    spendable,
    balance,
    hasPromo: Boolean(code),
    policy: rewardsSettings.discount,
  });

  const totals =
    cart.orderLines.length > 0
      ? calculateOrderTotal({
          lines: cart.orderLines,
          promo: promoRule,
          promoCustomerUses: promoUses,
          rewards: choices.requests,
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

  // Rewards: what applied, what could not (each a problem, like a failed
  // code, so it never silently drops off), and the list to choose from.
  const verdicts = totals?.ok ? appliedRewards(totals.rewards, choices.tiers) : { applied: [], rejected: [] };
  const rejected = [...choices.rejected, ...verdicts.rejected];
  if (choices.blocked) problems.push(choices.blocked);
  for (const rejection of rejected) problems.push(rejection.message);

  const lineLabels = new Map(
    cart.lines.flatMap((line) =>
      line.current ? [[line.id, [line.current.productName, line.current.sizeName].filter(Boolean).join(" · ")] as const] : [],
    ),
  );
  const promoDiscountCents = totals?.ok ? totals.breakdown.promoDiscountCents : 0;
  const rewards: CheckoutRewards = {
    programName: rewardsSettings.programName,
    balance,
    heldPoints: held.points,
    policy: rewardsSettings.discount,
    applied: verdicts.applied,
    rejected,
    options: rewardOptions({
      tiers,
      lines: totals?.ok ? totals.lines : [],
      lineLabels,
      applied: verdicts.applied,
      spendable,
      balance,
      heldPoints: held.points,
      policy: rewardsSettings.discount,
      amountOffRoomCents: totals?.ok
        ? totals.breakdown.subtotalCents - (rewardsSettings.discount.allowPromoWithReward ? promoDiscountCents : 0)
        : 0,
    }),
    pointsToEarn: totals?.ok ? pointsForOrder(pointsEligibleCents(totals.breakdown), rewardsSettings.earn) : 0,
  };

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
    rewardTiers: choices.tiers,
    rewards,
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
    rewards: prepared.rewards,
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
    rewards: input.rewards.map((r) => [r.rewardId, r.lineId ?? null]),
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

/**
 * A $0.00 order -- a reward paid for all of it -- has nothing to wait for:
 * it is placed now, which also turns its points reservation into a
 * redemption. Everything checkout checks has just been checked.
 */
async function placeFreeOrder(orderId: string): Promise<CreateCheckoutResult> {
  const { data: outcome, error } = await createAdminClient().rpc("place_free_order", { p_order_id: orderId });
  if (error) {
    console.error(`Order ${orderId}: could not place the free order`, error);
    return { ok: false, code: "invalid", message: "We couldn't place your order. Please try again." };
  }
  if (outcome === "placed" || outcome === "already_placed") return { ok: true, orderId, alreadyPaid: true };
  return { ok: false, code: "expired", message: "This checkout was cancelled. Please try again." };
}

/** Returns the order's PaymentIntent client secret, creating the intent once. */
async function ensurePayment(order: OrderForPayment): Promise<CreateCheckoutResult> {
  if (order.total_cents === 0) return placeFreeOrder(order.id);
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

  // The customer changed something after submitting an earlier attempt in
  // this browser: that unpaid order goes first, so it cannot be paid as well,
  // and any points it was holding come back for this one.
  if (input.replacesIdempotencyKey && input.replacesIdempotencyKey !== input.idempotencyKey) {
    const { data: replaced } = await db
      .from("orders")
      .select("id, user_id, status")
      .eq("idempotency_key", input.replacesIdempotencyKey)
      .maybeSingle();
    if (replaced && replaced.user_id === profile.id && replaced.status === "pending_payment") {
      const outcome = await cancelUnpaidCheckout(replaced.id, REPLACED_REASON);
      if (outcome === "money_on_its_way") {
        return {
          ok: false,
          code: "invalid",
          message: "Your earlier payment is still going through. Check Orders before paying again.",
        };
      }
    }
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
  // $0.00 (a reward covered everything) needs no card; anything else must
  // reach the card minimum.
  if (totals.breakdown.totalCents > 0 && totals.breakdown.totalCents < MINIMUM_CHARGE_CENTS) {
    return {
      ok: false,
      code: "minimum_charge",
      message: minimumChargeMessage(totals.breakdown.rewardDiscountCents > 0),
      quote: toQuote(prepared),
    };
  }

  const { breakdown } = totals;
  // Line ids are chosen here so each reward can name the line it went on.
  const itemIds = new Map(totals.lines.map((line) => [line.lineId, randomUUID()]));
  const redeemed = totals.rewards.flatMap((evaluation, index) => (evaluation.ok ? [{ evaluation, tier: prepared.rewardTiers[index] }] : []));
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
      reward_discount_cents: breakdown.rewardDiscountCents,
      points_earned: prepared.rewards.pointsToEarn,
      points_redeemed: redeemed.reduce((sum, r) => sum + r.tier.pointsCost, 0),
      customer_first_name: input.cupName,
      customer_phone: profile.phone,
      customer_email: profile.email,
      notes: input.notes || null,
      idempotency_key: input.idempotencyKey,
      checkout_fingerprint: print,
    },
    p_items: totals.lines.map((line) => ({
      id: itemIds.get(line.lineId),
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
    p_rewards: redeemed.map(({ evaluation, tier }) => ({
      reward_id: tier.id,
      reward_name: tier.name,
      reward_type: tier.type,
      points_cost: tier.pointsCost,
      discount_cents: evaluation.discountCents,
      order_item_id: evaluation.lineId ? (itemIds.get(evaluation.lineId) ?? null) : null,
      option_name: evaluation.optionName,
    })),
  });

  // Another checkout spent the points between the quote and now (the
  // database checks under a lock, so only one of them can win).
  if (error?.code === "DC004") {
    return {
      ok: false,
      code: "invalid",
      message: "You don't have enough points for that reward any more.",
      quote: toQuote(await prepare(input, profile.id, input.idempotencyKey)),
    };
  }

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

"use server";

/**
 * Server Actions behind the cart, checkout and confirmation pages. Thin
 * wrappers: validation, pricing and payments live in ./service.ts and
 * @/lib/payments, and every action re-checks who is calling.
 */
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/dal";
import { cartLinesSchema, type CheckoutInput, type QuoteInput } from "@/lib/checkout/schemas";
import { checkCart, createCheckout, quote } from "@/lib/checkout/service";
import type { CartCheck, CheckoutQuote, CreateCheckoutResult } from "@/lib/checkout/types";
import { getProductPageData, type ProductPageData } from "@/lib/menu/queries";
import { getOrderConfirmation, type OrderConfirmation } from "@/lib/orders/confirmation";
import { paymentProvider } from "@/lib/payments";
import { createAdminClient } from "@/lib/supabase/admin";

/** Cart page, guests included: every line against live data. */
export async function checkCartAction(lines: unknown): Promise<CartCheck | { error: string }> {
  const parsed = cartLinesSchema.safeParse(lines);
  if (!parsed.success) return { error: "Your cart couldn't be read. Try removing the last item you added." };
  return checkCart(parsed.data);
}

export async function quoteCheckoutAction(input: QuoteInput): Promise<CheckoutQuote | { signedOut: true } | { error: string }> {
  try {
    return await quote(input);
  } catch (error) {
    if (error instanceof z.ZodError) return { error: "Your order couldn't be read. Please refresh the page." };
    throw error;
  }
}

export async function createCheckoutAction(input: CheckoutInput): Promise<CreateCheckoutResult> {
  return createCheckout(input);
}

/** Product data for editing a cart line in place. */
export async function loadProductForEditAction(slug: unknown): Promise<ProductPageData | null> {
  const parsed = z.string().min(1).max(120).regex(/^[a-z0-9-]+$/).safeParse(slug);
  return parsed.success ? getProductPageData(parsed.data) : null;
}

export async function getOrderConfirmationAction(orderId: unknown): Promise<OrderConfirmation | null> {
  return typeof orderId === "string" ? getOrderConfirmation(orderId) : null;
}

/**
 * The client secret to try paying for an unpaid order again, for its owner
 * only. Never stored; fetched from the provider each time.
 */
export async function resumePaymentAction(
  orderId: unknown,
): Promise<{ ok: true; clientSecret: string; totalCents: number } | { ok: false; message: string }> {
  if (!z.guid().safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in to finish paying." };

  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, user_id, status, total_cents, payments(provider_payment_intent_id, created_at)")
    .eq("id", orderId as string)
    .maybeSingle();
  if (!order || order.user_id !== profile.id) return { ok: false, message: "Order not found." };
  if (order.status !== "pending_payment") return { ok: false, message: "This order no longer needs paying." };

  const latest = [...(order.payments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest?.provider_payment_intent_id) return { ok: false, message: "Please start checkout again." };

  const payment = await paymentProvider().retrievePayment(latest.provider_payment_intent_id);
  if (payment.status === "succeeded" || payment.status === "processing") {
    return { ok: false, message: "Your payment is already going through." };
  }
  if (payment.status === "canceled") return { ok: false, message: "This checkout expired. Please start again." };
  return { ok: true, clientSecret: payment.clientSecret, totalCents: order.total_cents };
}

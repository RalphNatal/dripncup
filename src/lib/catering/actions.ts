"use server";

/**
 * The customer's catering actions. Each one checks who is calling; status
 * changes go through the database's definer functions, run as the customer
 * (so the database checks ownership and the transition rules itself).
 */
import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { kickOutbox } from "@/lib/email/outbox";
import { issuesByPath } from "@/lib/forms";
import { reconcileCateringPayment } from "@/lib/payments/reconcile";
import { LIMITS, hitUserAndIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProductAvailableAt } from "@/lib/menu/availability-window";
import { createClient } from "@/lib/supabase/server";
import { cafeInstant, formatCafeDate, formatCafeTimeOfDay } from "@/lib/time";

import { cancelOpenCateringPayments, paymentIntentForQuote, type StartPaymentResult } from "./payment";
import { getCateringMenu } from "./queries";
import { checkDeliveryArea, earliestEventAt, isInsideLeadTime, quotePayability } from "./rules";
import {
  budgetCents,
  cateringCancelSchema,
  cateringMessageSchema,
  cateringRequestSchema,
  type CateringRequestInput,
} from "./schemas";
import { getCateringSettings } from "./settings";
import type { CateringStatus } from "./status";

export type SubmitCateringResult =
  | { ok: true; requestId: string; requestNumber: string }
  | { ok: false; signedOut?: boolean; message: string; fieldErrors?: Record<string, string> };

/** Most days ahead a request can be for. */
const MAX_DAYS_AHEAD = 366;

export async function submitCateringRequestAction(input: CateringRequestInput): Promise<SubmitCateringResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, signedOut: true, message: "Sign in to send a catering request." };

  const parsed = cateringRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Please check the highlighted fields.", fieldErrors: issuesByPath(parsed.error) };
  }
  const form = parsed.data;
  const [settings, now] = await Promise.all([getCateringSettings(), appNow()]);

  const eventAt = cafeInstant(form.eventDate, form.eventTime);
  if (!eventAt) return { ok: false, message: "Please check the date.", fieldErrors: { eventDate: "That date doesn't exist." } };
  if (isInsideLeadTime(eventAt, now, settings.minLeadTimeHours)) {
    const earliest = earliestEventAt(now, settings.minLeadTimeHours);
    return {
      ok: false,
      message: "That's too soon for catering.",
      fieldErrors: {
        eventDate: `Catering needs at least ${settings.minLeadTimeHours} hours' notice. The earliest we can do is ${formatCafeDate(earliest)} at ${formatCafeTimeOfDay(earliest)}.`,
      },
    };
  }
  if (eventAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 86_400_000) {
    return { ok: false, message: "Please check the date.", fieldErrors: { eventDate: "We take catering requests up to a year ahead." } };
  }

  let deliveryZip: string | null = null;
  if (form.fulfillment === "delivery") {
    const area = checkDeliveryArea(form.deliveryZip, { deliveryOffered: settings.deliveryOffered, zipCodes: settings.deliveryZipCodes });
    if (!area.ok) return { ok: false, message: area.message, fieldErrors: { deliveryZip: area.message } };
    deliveryZip = area.zip;
  }

  // Every drink must be a catering drink on the menu on the day, in a size it comes in.
  const menu = await getCateringMenu();
  const items = [];
  for (const [index, item] of form.items.entries()) {
    const product = menu.find((p) => p.id === item.productId);
    const size = product?.sizes.find((s) => s.id === item.sizeId) ?? null;
    if (!product) return { ok: false, message: "Please check your drinks.", fieldErrors: { [`items.${index}`]: "That drink isn't available for catering." } };
    if (!isProductAvailableAt({ available_from: product.availableFrom, available_until: product.availableUntil }, eventAt)) {
      return { ok: false, message: "Please check your drinks.", fieldErrors: { [`items.${index}`]: `${product.name} isn't on the menu on your event date.` } };
    }
    if (product.sizes.length > 0 ? !size : item.sizeId !== null) {
      return { ok: false, message: "Please check your drinks.", fieldErrors: { [`items.${index}`]: `Pick a size for ${product.name}.` } };
    }
    items.push({ product_id: product.id, product_size_id: size?.id ?? null, product_name: product.name, size_name: size?.name ?? null, quantity: item.quantity, notes: null });
  }
  if (form.customDrink) {
    items.push({ product_id: null, product_size_id: null, product_name: "Custom signature drink", size_name: null, quantity: form.headcount, notes: null });
  }

  if (!(await hitUserAndIp(LIMITS.cateringRequestPerUser, LIMITS.cateringRequestPerIp, profile.id))) {
    return { ok: false, message: "You've sent a lot of requests in a short time. Please wait a while and try again, or contact us." };
  }

  const db = createAdminClient();
  const { data: cafe } = await db
    .from("locations")
    .select("id")
    .eq("type", "cafe")
    .eq("is_active", true)
    .order("sort_order")
    .limit(1)
    .maybeSingle();

  const { data, error } = await db.rpc("create_catering_request", {
    p_user_id: profile.id,
    p_request: {
      location_id: cafe?.id ?? null,
      contact_name: form.contactName,
      contact_email: form.contactEmail,
      contact_phone: form.contactPhone,
      event_at: eventAt.toISOString(),
      headcount: form.headcount,
      fulfillment: form.fulfillment,
      delivery_address: form.fulfillment === "delivery" ? form.deliveryAddress : null,
      delivery_postal_code: deliveryZip,
      budget_cents: budgetCents(form.budget),
      notes: form.notes || null,
      custom_drink_request: form.customDrink ? form.customDrinkRequest : null,
    },
    p_items: items,
  });
  if (error) {
    // The lead-time trigger: the clock moved on between the check above and now.
    if (error.code === "23514" && /notice/.test(error.message)) {
      return { ok: false, message: "That's too soon for catering.", fieldErrors: { eventDate: error.message + "." } };
    }
    throw new Error(`Could not create the catering request: ${error.message}`);
  }
  const created = data?.[0];
  if (!created) throw new Error("Could not create the catering request.");

  kickOutbox();
  revalidatePath("/account/catering");
  return { ok: true, requestId: created.request_id, requestNumber: created.request_number };
}

// ---------------------------------------------------------------------------
// Changes, cancellation.
// ---------------------------------------------------------------------------

export type CateringActionResult = { ok: true; status: CateringStatus } | { ok: false; message: string };

function messageFor(error: PostgrestError, fallback: string): string {
  switch (error.code) {
    case "42501":
      return "We couldn't find that request.";
    case "DC010":
      return "This request has moved on since you opened it. Refresh to see where it stands.";
    case "DC014":
      return "You've already asked us to cancel. We'll be in touch.";
    case "DC015":
      return "This request has been paid for. Use “Ask to cancel” and we'll be in touch about a refund.";
    case "22023":
      return error.message;
    default:
      return fallback;
  }
}

export async function requestCateringChangesAction(input: unknown): Promise<CateringActionResult> {
  const parsed = cateringMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Write a few words." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Please sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catering_request_changes", {
    p_request_id: parsed.data.requestId,
    p_message: parsed.data.message,
  });
  if (error) return { ok: false, message: messageFor(error, "We couldn't send that. Please try again.") };

  // The quote went back: its unpaid PaymentIntent must not be completable.
  await cancelOpenCateringPayments(parsed.data.requestId);
  kickOutbox();
  revalidatePath(`/account/catering/${parsed.data.requestId}`);
  return { ok: true, status: data.status };
}

export async function cancelCateringRequestAction(input: unknown): Promise<CateringActionResult> {
  const parsed = cateringCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please try again." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Please sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catering_cancel", {
    p_request_id: parsed.data.requestId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: messageFor(error, "We couldn't cancel that. Please try again.") };

  await cancelOpenCateringPayments(parsed.data.requestId);
  kickOutbox();
  revalidatePath(`/account/catering/${parsed.data.requestId}`);
  return { ok: true, status: data.status };
}

export async function requestCateringCancellationAction(input: unknown): Promise<CateringActionResult> {
  const parsed = cateringCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please try again." };
  if (parsed.data.reason.length < 3) return { ok: false, message: "Tell us briefly why you need to cancel." };
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Please sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("catering_request_cancellation", {
    p_request_id: parsed.data.requestId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, message: messageFor(error, "We couldn't send that. Please try again.") };

  kickOutbox();
  revalidatePath(`/account/catering/${parsed.data.requestId}`);
  return { ok: true, status: data.status };
}

// ---------------------------------------------------------------------------
// Paying.
// ---------------------------------------------------------------------------

const PAYABILITY_MESSAGES: Record<string, string> = {
  "42501": "We couldn't find that quote.",
  DC010: "This request isn't waiting for payment.",
  DC011: "This quote has been replaced. Please review the latest one.",
  DC012: "This quote has expired. Ask us for a new one and we'll reissue it.",
  DC013: "It's too close to your event to pay online. Please contact us and we'll sort it out.",
};

/**
 * The client secret to pay a quote, for its owner only, while it is the
 * current quote, unexpired and before the payment deadline. Checked here
 * (with the request's clock, for clear messages) and by the database
 * (catering_payable_quote, as the customer); the webhook checks once more
 * before confirming.
 */
export async function startCateringPaymentAction(input: { requestId: unknown; quoteId: unknown }): Promise<StartPaymentResult> {
  const ids = [input.requestId, input.quoteId];
  if (!ids.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))) return { ok: false, message: "We couldn't find that quote." };
  const [requestId, quoteId] = ids as string[];
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Please sign in to pay." };

  const supabase = await createClient();
  const { data: request } = await supabase
    .from("catering_requests")
    .select("id, status, current_quote_id, quote:catering_quotes!catering_requests_current_quote_fk(id, status, expires_at, payment_deadline_at)")
    .eq("id", requestId)
    .maybeSingle();
  const quote = request?.quote;
  if (!request || !quote || quote.id !== quoteId) {
    return { ok: false, message: request?.status === "quoted" ? PAYABILITY_MESSAGES.DC011 : "This request isn't waiting for payment." };
  }

  const check = quotePayability({
    requestStatus: request.status,
    quote: { id: quote.id, status: quote.status, expiresAt: new Date(quote.expires_at), paymentDeadlineAt: new Date(quote.payment_deadline_at) },
    currentQuoteId: request.current_quote_id,
    now: await appNow(),
  });
  if (!check.payable) return { ok: false, message: check.message };

  const { data: payable, error } = await supabase.rpc("catering_payable_quote", { p_request_id: requestId, p_quote_id: quoteId });
  if (error) return { ok: false, message: PAYABILITY_MESSAGES[error.code] ?? "We couldn't start the payment. Please try again." };

  if (!(await hitUserAndIp(LIMITS.cateringPaymentPerUser, LIMITS.cateringPaymentPerIp, profile.id))) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }

  const facts = payable as { request_number: string; total_cents: number; version: number; contact_email: string | null };
  return paymentIntentForQuote({
    requestId,
    requestNumber: facts.request_number,
    quoteId,
    version: facts.version,
    totalCents: facts.total_cents,
    contactEmail: facts.contact_email,
  });
}

/** Where a request stands, for the pay page while it waits for the payment to land. */
export async function cateringPaymentStatusAction(requestId: unknown): Promise<{ status: CateringStatus | null; failure: string | null }> {
  if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) return { status: null, failure: null };
  const supabase = await createClient();
  const { data } = await supabase
    .from("catering_requests")
    .select("status, payments(status, failure_message, created_at)")
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return { status: null, failure: null };
  const latest = [...(data.payments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return { status: data.status, failure: latest?.status === "failed" ? (latest.failure_message ?? "Your card was declined.") : null };
}

/** The reconcile fallback for the pay page (owner only; throttled per payment). */
export async function reconcileCateringPaymentAction(requestId: unknown): Promise<{ outcome: string }> {
  if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) return { outcome: "no_payment" };
  const profile = await getCurrentProfile();
  if (!profile) return { outcome: "no_payment" };
  return { outcome: await reconcileCateringPayment(requestId, profile.id) };
}

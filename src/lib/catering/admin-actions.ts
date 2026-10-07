"use server";

/**
 * Admin catering actions. Every one re-checks that the caller is an admin
 * (the proxy and the page already did; Server Actions can be reached
 * without either), and the database checks again: quoting and
 * cancel-with-refund are service-role functions that take the admin's id
 * and verify it, the rest are definer functions run as the admin.
 */
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { kickOutbox } from "@/lib/email/outbox";
import { issuesByPath } from "@/lib/forms";
import { formatCents } from "@/lib/money";
import { refundPayment, refundableCents, type RefundOutcome } from "@/lib/payments/refunds";
import { calculateCateringQuote } from "@/lib/pricing";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { cancelOpenCateringPayments } from "./payment";
import { paymentDeadline } from "./rules";
import { adminCancelSchema, quoteSchema, type QuoteInput } from "./schemas";
import { getCateringSettings } from "./settings";

async function adminOrNull() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

function revalidate(requestId: string) {
  revalidatePath(`/admin/catering/${requestId}`);
  revalidatePath("/admin/catering");
  revalidatePath("/admin");
}

export type IssueQuoteResult =
  | { ok: true; quoteId: string; version: number; totalCents: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function issueQuoteAction(input: QuoteInput): Promise<IssueQuoteResult> {
  const admin = await adminOrNull();
  if (!admin) return { ok: false, message: "Only an admin can send quotes." };

  const parsed = quoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the quote.", fieldErrors: issuesByPath(parsed.error) };
  const form = parsed.data;

  const db = createAdminClient();
  const [{ data: request }, settings, now] = await Promise.all([
    db.from("catering_requests").select("id, status, event_at, fulfillment").eq("id", form.requestId).maybeSingle(),
    getCateringSettings(),
    appNow(),
  ]);
  if (!request) return { ok: false, message: "Request not found." };
  if (request.status !== "submitted" && request.status !== "quoted") {
    return { ok: false, message: `A ${request.status} request can't be quoted.` };
  }

  const deadline = paymentDeadline(new Date(request.event_at), settings.paymentDeadlineHours);
  const expiresAt = new Date(form.expiresAt);
  if (deadline.getTime() <= now.getTime()) {
    return { ok: false, message: `The payment deadline (${settings.paymentDeadlineHours} hours before the event) has passed, so this quote couldn't be paid online.` };
  }
  if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > deadline.getTime()) {
    return { ok: false, message: "Please check the expiry.", fieldErrors: { expiresAt: "The quote must expire in the future and no later than the payment deadline." } };
  }

  // Menu lines name a real product and, if it has sizes, one of them; the
  // size's name is snapshotted.
  const productIds = form.lines.flatMap((l) => (l.kind === "product" ? [l.productId] : []));
  const { data: sizes } = productIds.length
    ? await db.from("product_sizes").select("id, product_id, name").in("product_id", productIds)
    : { data: [] as { id: string; product_id: string; name: string }[] };
  const { data: products } = productIds.length
    ? await db.from("products").select("id").in("id", productIds)
    : { data: [] as { id: string }[] };
  for (const [index, line] of form.lines.entries()) {
    if (line.kind !== "product") continue;
    if (!products?.some((p) => p.id === line.productId)) {
      return { ok: false, message: "Please check the quote.", fieldErrors: { [`lines.${index}`]: "That product no longer exists." } };
    }
    if (line.sizeId && !sizes?.some((s) => s.id === line.sizeId && s.product_id === line.productId)) {
      return { ok: false, message: "Please check the quote.", fieldErrors: { [`lines.${index}`]: "That size doesn't belong to the product." } };
    }
  }

  const deliveryFeeCents = request.fulfillment === "delivery" ? form.deliveryFeeCents : 0;
  const priced = calculateCateringQuote({
    lines: form.lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents })),
    deliveryFeeCents,
    deliveryFeeTaxable: settings.deliveryFeeTaxable,
    discount:
      form.discount === null
        ? null
        : form.discount.kind === "amount"
          ? { kind: "amount", amountCents: form.discount.amountCents, label: form.discount.label || null }
          : { kind: "percent", percent: form.discount.percent, label: form.discount.label || null },
    gratuity: form.gratuity,
    gratuityTaxable: settings.gratuityTaxable,
    taxRate: settings.taxRate,
  });
  if (!priced.ok) {
    return {
      ok: false,
      message: priced.problems[0]?.message ?? "Please check the quote.",
      fieldErrors: Object.fromEntries(priced.problems.map((p) => [p.field, p.message])),
    };
  }
  const b = priced.breakdown;

  const { data: quoteId, error } = await db.rpc("catering_issue_quote", {
    p_actor: admin.id,
    p_request_id: request.id,
    p_quote: {
      items_subtotal_cents: b.itemsSubtotalCents,
      discount_cents: b.discountCents,
      discount_label: b.discountLabel,
      delivery_fee_cents: b.deliveryFeeCents,
      delivery_fee_taxable: b.deliveryFeeTaxable,
      taxable_cents: b.taxableCents,
      tax_rate: b.taxRate,
      tax_cents: b.taxCents,
      gratuity_percent: b.gratuityPercent,
      gratuity_cents: b.gratuityCents,
      gratuity_taxable: b.gratuityTaxable,
      total_cents: b.totalCents,
      expires_at: expiresAt.toISOString(),
      note_to_customer: form.noteToCustomer || null,
    },
    p_lines: priced.lines.map((line, index) => {
      const source = form.lines[index];
      const productId = source.kind === "product" ? source.productId : null;
      const sizeId = source.kind === "product" ? source.sizeId : null;
      return {
        kind: line.kind,
        product_id: productId,
        product_size_id: sizeId,
        description: line.description,
        size_name: sizeId ? (sizes?.find((s) => s.id === sizeId)?.name ?? null) : null,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        line_total_cents: line.lineTotalCents,
      };
    }),
  });
  if (error || !quoteId) {
    if (error?.code === "DC010") return { ok: false, message: "This request has moved on; refresh to see where it stands." };
    if (error?.code === "DC013") return { ok: false, message: "The payment deadline for this event has passed." };
    throw new Error(`Could not issue the quote: ${error?.message}`);
  }

  // An older version's unpaid PaymentIntent must not be completable.
  await cancelOpenCateringPayments(request.id, quoteId);
  const { data: issued } = await db.from("catering_quotes").select("version, total_cents").eq("id", quoteId).single();
  kickOutbox();
  revalidate(request.id);
  return { ok: true, quoteId, version: issued?.version ?? 1, totalCents: issued?.total_cents ?? b.totalCents };
}

export type AdminCancelResult =
  | { ok: true; refund: RefundOutcome | null; message: string }
  | { ok: false; message: string };

/**
 * Cancels a request. Before payment, free (no money moves). After payment,
 * with a full refund (default), a partial one, or none, through the same
 * refund machinery as orders. Refund policy: NEEDS_CONFIRMATION.
 */
export async function adminCancelCateringAction(input: unknown): Promise<AdminCancelResult> {
  const admin = await adminOrNull();
  if (!admin) return { ok: false, message: "Only an admin can cancel catering." };
  const parsed = adminCancelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Please check the form." };
  const { requestId, reason, refund } = parsed.data;

  const db = createAdminClient();
  const { data: request } = await db.from("catering_requests").select("id, status").eq("id", requestId).maybeSingle();
  if (!request) return { ok: false, message: "Request not found." };

  if (request.status === "confirmed") {
    const available = await refundableCents({ kind: "catering", requestId });
    if (typeof refund === "number" && refund > available) {
      return { ok: false, message: `You can refund at most ${formatCents(available)}.` };
    }
    const { data: outcome, error } = await db.rpc("catering_cancel_for_refund", {
      p_actor: admin.id,
      p_request_id: requestId,
      p_reason: reason,
    });
    if (error) throw new Error(`Could not cancel catering ${requestId}: ${error.message}`);
    if (outcome !== "cancelled") return { ok: false, message: "This request can no longer be cancelled." };

    // Cancelled first, then refunded: a failed refund stays in `refunds` as
    // failed for a retry, and the request is off the prep list either way.
    let result: RefundOutcome | null = null;
    if (refund !== "none") {
      result = await refundPayment({
        subject: { kind: "catering", requestId },
        amountCents: typeof refund === "number" ? refund : undefined,
        reason,
        requestedBy: admin.id,
      });
    }
    kickOutbox();
    revalidate(requestId);
    const message =
      result === null
        ? "Cancelled without a refund."
        : result.ok
          ? `Cancelled and refunded ${formatCents(result.amountCents)}.`
          : result.reason === "failed"
            ? "Cancelled, but the refund failed. It's recorded for a retry."
            : "Cancelled. There was nothing left to refund.";
    return { ok: true, refund: result, message };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_catering_cancel", { p_request_id: requestId, p_reason: reason });
  if (error) {
    return { ok: false, message: error.code === "DC010" ? "This request can no longer be cancelled." : "Couldn't cancel. Please try again." };
  }
  await cancelOpenCateringPayments(requestId);
  kickOutbox();
  revalidate(requestId);
  return { ok: true, refund: null, message: "Cancelled." };
}

export async function markCateringFulfilledAction(requestId: unknown): Promise<{ ok: boolean; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "admin" && profile.role !== "staff")) return { ok: false, message: "Not allowed." };
  if (typeof requestId !== "string") return { ok: false, message: "Request not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("catering_mark_fulfilled", { p_request_id: requestId });
  if (error) {
    return {
      ok: false,
      message: error.code === "DC016" ? "You can mark it fulfilled from the day of the event." : "Couldn't mark it fulfilled.",
    };
  }
  revalidate(requestId);
  return { ok: true, message: "Marked fulfilled." };
}

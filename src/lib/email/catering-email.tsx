import "server-only";

/**
 * Builds one catering email for an outbox row, from the request as it is
 * now, and decides at send time whether it is still owed: nothing to an
 * anonymised request, no "quote ready" for a quote already replaced, no
 * reminder for an event no longer confirmed, no admin email without an
 * admin address configured.
 */
import { render } from "react-email";

import {
  AdminCateringEmail,
  CateringCancelledEmail,
  CateringConfirmedEmail,
  CateringQuoteReadyEmail,
  CateringReceivedEmail,
  CateringReminderEmail,
  adminCateringText,
  cateringCancelledText,
  cateringConfirmedText,
  cateringQuoteReadyText,
  cateringReceivedText,
  cateringReminderText,
  type AdminCateringEmailData,
  type CateringEmailData,
  type CateringQuoteEmailData,
} from "@/emails/catering-emails";
import { BRAND } from "@/lib/brand";
import { eventWhen, quoteRows } from "@/lib/catering/format";
import { getCateringSettings } from "@/lib/catering/settings";
import { clientEnv } from "@/lib/env";
import { formatCents } from "@/lib/money";
import { paymentMethodLabel } from "@/lib/orders/detail";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatCafeDate } from "@/lib/time";

import type { ComposedEmail } from "./order-email";

export type CateringEmailKind =
  | "catering_received"
  | "catering_quote_ready"
  | "catering_confirmed"
  | "catering_reminder"
  | "catering_cancelled"
  | "catering_admin_new"
  | "catering_admin_change_request"
  | "catering_admin_paid"
  | "catering_admin_cancellation_request";

export function isCateringEmailKind(kind: string): kind is CateringEmailKind {
  return kind.startsWith("catering_");
}

const REQUEST_SELECT = `
  id, request_number, status, event_at, headcount, fulfillment, delivery_address, delivery_postal_code,
  contact_name, contact_email, contact_phone, budget_cents, notes, custom_drink_request, cancellation_reason,
  current_quote_id, anonymized_at,
  location:locations(name),
  items:catering_request_items(product_name, size_name, quantity, created_at),
  quotes:catering_quotes!catering_quotes_catering_request_id_fkey(
    id, version, status, items_subtotal_cents, discount_cents, discount_label, delivery_fee_cents, tax_rate, tax_cents,
    gratuity_percent, gratuity_cents, total_cents, expires_at, payment_deadline_at, note_to_customer,
    lines:catering_quote_lines(description, size_name, quantity, line_total_cents, sort_order)
  ),
  payments(id, status, amount_cents, refunded_cents, catering_quote_id, method_brand, method_last4, method_wallet, created_at),
  refunds(amount_cents, status)
`;

type QuoteRow = {
  id: string;
  version: number;
  status: string;
  items_subtotal_cents: number;
  discount_cents: number;
  discount_label: string | null;
  delivery_fee_cents: number;
  tax_rate: number;
  tax_cents: number;
  gratuity_percent: number | null;
  gratuity_cents: number;
  total_cents: number;
  expires_at: string;
  payment_deadline_at: string;
  note_to_customer: string | null;
  lines: { description: string; size_name: string | null; quantity: number; line_total_cents: number; sort_order: number }[];
};

type RequestRow = {
  id: string;
  request_number: string;
  status: string;
  event_at: string;
  headcount: number;
  fulfillment: "pickup" | "delivery";
  delivery_address: string | null;
  delivery_postal_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  budget_cents: number | null;
  notes: string | null;
  custom_drink_request: string | null;
  cancellation_reason: string | null;
  current_quote_id: string | null;
  anonymized_at: string | null;
  location: { name: string } | null;
  items: { product_name: string; size_name: string | null; quantity: number; created_at: string }[];
  quotes: QuoteRow[];
  payments: {
    id: string;
    status: string;
    amount_cents: number;
    refunded_cents: number;
    catering_quote_id: string | null;
    method_brand: string | null;
    method_last4: string | null;
    method_wallet: string | null;
    created_at: string;
  }[];
  refunds: { amount_cents: number; status: string }[];
};

const siteUrl = (path: string) => new URL(path, clientEnv.NEXT_PUBLIC_SITE_URL).toString();

function emailData(r: RequestRow): CateringEmailData {
  const location = r.location?.name ?? BRAND.name;
  return {
    requestNumber: r.request_number,
    firstName: r.contact_name?.trim().split(/\s+/)[0] ?? null,
    eventWhen: eventWhen(r.event_at),
    headcount: r.headcount,
    fulfillmentLine:
      r.fulfillment === "delivery"
        ? `Delivery to ${[r.delivery_address, r.delivery_postal_code].filter(Boolean).join(", ")}`
        : `Pickup at ${location}`,
    requested: [...r.items]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .filter((i) => i.product_name !== "Custom signature drink")
      .map((i) => `${i.quantity} × ${i.product_name}${i.size_name ? ` (${i.size_name})` : ""}`),
    customDrink: r.custom_drink_request,
    requestUrl: siteUrl(`/account/catering/${r.id}`),
  };
}

function quoteData(q: QuoteRow): CateringQuoteEmailData {
  const payBy = new Date(Math.min(Date.parse(q.expires_at), Date.parse(q.payment_deadline_at)));
  return {
    version: q.version,
    lines: [...q.lines]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ quantity: l.quantity, description: l.size_name ? `${l.description} (${l.size_name})` : l.description, total: formatCents(l.line_total_cents) })),
    breakdown: quoteRows({
      itemsSubtotalCents: q.items_subtotal_cents,
      discountCents: q.discount_cents,
      discountLabel: q.discount_label,
      deliveryFeeCents: q.delivery_fee_cents,
      taxRate: Number(q.tax_rate),
      taxCents: q.tax_cents,
      gratuityPercent: q.gratuity_percent === null ? null : Number(q.gratuity_percent),
      gratuityCents: q.gratuity_cents,
      totalCents: q.total_cents,
    }),
    payBy: `Pay by ${eventWhen(payBy.toISOString())} to confirm.`,
    note: q.note_to_customer,
  };
}

function paidWith(r: RequestRow, quoteId: string | null): string | null {
  const paid = r.payments.find((p) => p.catering_quote_id === quoteId && ["succeeded", "partially_refunded", "refunded"].includes(p.status));
  if (!paid) return null;
  return paymentMethodLabel({ brand: paid.method_brand, last4: paid.method_last4, wallet: paid.method_wallet });
}

/** What happened to the money, for the cancellation email; null when none was taken. */
function refundSentence(r: RequestRow): string | null {
  const taken = r.payments.filter((p) => ["succeeded", "partially_refunded", "refunded"].includes(p.status));
  if (taken.length === 0) return null;
  const paidCents = taken.reduce((sum, p) => sum + p.amount_cents, 0);
  const refunded = r.refunds.filter((x) => x.status === "succeeded" || x.status === "pending").reduce((sum, x) => sum + x.amount_cents, 0);
  if (refunded <= 0) return `You paid ${formatCents(paidCents)}. This payment was not refunded; please contact us with any questions.`;
  const amount = Math.min(refunded, paidCents);
  return amount >= paidCents
    ? `We've refunded the full ${formatCents(amount)}. It can take 5–10 business days to show on your statement.`
    : `We've refunded ${formatCents(amount)} of the ${formatCents(paidCents)} you paid. It can take 5–10 business days to show on your statement.`;
}

function adminRows(r: RequestRow): AdminCateringEmailData["rows"] {
  return [
    { label: "Event", value: `${eventWhen(r.event_at)} · ${r.headcount} guests` },
    { label: r.fulfillment === "delivery" ? "Delivery" : "Pickup", value: r.fulfillment === "delivery" ? [r.delivery_address, r.delivery_postal_code].filter(Boolean).join(", ") : (r.location?.name ?? BRAND.name) },
    { label: "Contact", value: [r.contact_name, r.contact_phone, r.contact_email].filter(Boolean).join(" · ") || "—" },
    ...(r.budget_cents !== null ? [{ label: "Budget", value: formatCents(r.budget_cents) }] : []),
    ...(r.items.length ? [{ label: "Asked for", value: r.items.map((i) => `${i.quantity} × ${i.product_name}${i.size_name ? ` (${i.size_name})` : ""}`).join(", ") }] : []),
    ...(r.custom_drink_request ? [{ label: "Signature drink", value: r.custom_drink_request }] : []),
    ...(r.notes ? [{ label: "Notes", value: r.notes }] : []),
  ];
}

export async function composeCateringEmail(row: {
  kind: CateringEmailKind;
  catering_request_id: string | null;
  catering_quote_id: string | null;
  catering_message_id: string | null;
}): Promise<ComposedEmail> {
  if (!row.catering_request_id) return { send: false, reason: "no catering request" };
  const db = createAdminClient();
  const { data } = await db.from("catering_requests").select(REQUEST_SELECT).eq("id", row.catering_request_id).maybeSingle();
  if (!data) return { send: false, reason: "catering request not found" };
  const r = data as unknown as RequestRow;
  const settings = await getCateringSettings();

  if (row.kind.startsWith("catering_admin_")) {
    const to = settings.adminNotificationEmail;
    if (!to) return { send: false, reason: "no admin notification address configured" };
    const base = { requestNumber: r.request_number, rows: adminRows(r), adminUrl: siteUrl(`/admin/catering/${r.id}`) };
    let heading = "New catering request";
    let message: string | null = null;
    if (row.kind === "catering_admin_change_request" || row.kind === "catering_admin_cancellation_request") {
      const { data: msg } = row.catering_message_id
        ? await db.from("catering_messages").select("body").eq("id", row.catering_message_id).maybeSingle()
        : { data: null };
      message = msg?.body ?? null;
      heading = row.kind === "catering_admin_change_request" ? "Changes requested on a catering quote" : "Cancellation requested for paid catering";
    } else if (row.kind === "catering_admin_paid") {
      const quote = r.quotes.find((q) => q.id === (row.catering_quote_id ?? r.current_quote_id));
      heading = "Catering payment received";
      if (quote) base.rows.unshift({ label: "Paid", value: `${formatCents(quote.total_cents)} (quote v${quote.version})` });
    }
    const adminData: AdminCateringEmailData = { ...base, heading, message };
    return {
      send: true,
      to,
      subject: `${heading} · ${r.request_number}`,
      html: await render(<AdminCateringEmail data={adminData} />),
      text: adminCateringText(adminData),
    };
  }

  const to = r.anonymized_at ? null : r.contact_email;
  if (!to) return { send: false, reason: "no recipient" };
  const base = emailData(r);

  switch (row.kind) {
    case "catering_received":
      return {
        send: true,
        to,
        subject: `We got your catering request · ${r.request_number}`,
        html: await render(<CateringReceivedEmail data={base} leadTimeHours={settings.minLeadTimeHours} />),
        text: cateringReceivedText(base, settings.minLeadTimeHours),
      };

    case "catering_quote_ready": {
      const quote = r.quotes.find((q) => q.id === row.catering_quote_id);
      if (!quote) return { send: false, reason: "quote not found" };
      if (quote.status !== "active" || r.status !== "quoted") return { send: false, reason: `quote is ${quote.status}, request ${r.status}` };
      const q = quoteData(quote);
      return {
        send: true,
        to,
        subject: `${quote.version > 1 ? "Your revised catering quote" : "Your catering quote"} · ${r.request_number}`,
        html: await render(<CateringQuoteReadyEmail data={base} quote={q} />),
        text: cateringQuoteReadyText(base, q),
      };
    }

    case "catering_confirmed": {
      const quoteId = row.catering_quote_id ?? r.current_quote_id;
      const quote = r.quotes.find((q) => q.id === quoteId);
      if (!quote) return { send: false, reason: "paid quote not found" };
      const q = quoteData(quote);
      const method = paidWith(r, quote.id);
      return {
        send: true,
        to,
        subject: `You're confirmed! Catering receipt · ${r.request_number}`,
        html: await render(<CateringConfirmedEmail data={base} quote={q} paidWith={method} />),
        text: cateringConfirmedText(base, q, method),
      };
    }

    case "catering_reminder":
      if (r.status !== "confirmed" || Date.parse(r.event_at) <= Date.now()) return { send: false, reason: `request is ${r.status}` };
      return {
        send: true,
        to,
        subject: `See you soon! Catering on ${formatCafeDate(new Date(r.event_at))} · ${r.request_number}`,
        html: await render(<CateringReminderEmail data={base} />),
        text: cateringReminderText(base),
      };

    case "catering_cancelled": {
      const reason = r.cancellation_reason;
      const refund = refundSentence(r);
      return {
        send: true,
        to,
        subject: `Catering request ${r.request_number} was cancelled`,
        html: await render(<CateringCancelledEmail data={base} reason={reason} refund={refund} />),
        text: cateringCancelledText(base, reason, refund),
      };
    }

    default:
      return { send: false, reason: `unknown kind ${row.kind}` };
  }
}

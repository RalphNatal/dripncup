import "server-only";

/**
 * Reading catering requests. Customers read through their own session (RLS:
 * their own requests, quotes, messages and history only); admins through
 * theirs (RLS: everything). Nothing here uses the service role, so the
 * database decides who sees what.
 */
import { paymentMethodLabel } from "@/lib/orders/detail";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

import type { CateringStatus } from "./status";

// ---------------------------------------------------------------------------
// The drinks a customer can choose from.
// ---------------------------------------------------------------------------

export interface CateringMenuSize {
  id: string;
  name: string;
  priceCents: number;
}

export interface CateringMenuProduct {
  id: string;
  name: string;
  categoryName: string | null;
  basePriceCents: number;
  sizes: CateringMenuSize[];
  availableFrom: string | null;
  availableUntil: string | null;
}

/** Active, catering-eligible products with their active sizes, in menu order. */
export async function getCateringMenu(): Promise<CateringMenuProduct[]> {
  const { data, error } = await createPublicClient({ live: true })
    .from("products")
    .select(
      "id, name, base_price_cents, sort_order, available_from, available_until, category:categories(name, sort_order), sizes:product_sizes(id, name, price_cents, sort_order)",
    )
    .eq("is_catering_eligible", true)
    .order("sort_order");
  if (error) throw new Error(`Catering: could not load drinks (${error.message})`);

  return (data ?? [])
    // A product in a switched-off category is not on the menu (RLS hides the category).
    .filter((p) => p.category !== null)
    .sort((a, b) => (a.category?.sort_order ?? 0) - (b.category?.sort_order ?? 0) || a.sort_order - b.sort_order)
    .map((p) => ({
      id: p.id,
      name: p.name,
      categoryName: p.category?.name ?? null,
      basePriceCents: p.base_price_cents,
      sizes: [...(p.sizes ?? [])]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((s) => ({ id: s.id, name: s.name, priceCents: s.price_cents })),
      availableFrom: p.available_from,
      availableUntil: p.available_until,
    }));
}

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------

export interface CateringRequestSummary {
  id: string;
  requestNumber: string;
  status: CateringStatus;
  eventAt: string;
  headcount: number;
  fulfillment: Enums<"fulfillment_type">;
  createdAt: string;
  contactName: string | null;
  /** The current quote's total, if there is one. */
  totalCents: number | null;
  /** Unread in the admin inbox. */
  isNew: boolean;
  cancellationRequested: boolean;
}

export interface CateringQuoteLineView {
  kind: "product" | "custom";
  productId: string | null;
  sizeId: string | null;
  description: string;
  sizeName: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface CateringQuoteView {
  id: string;
  version: number;
  status: "active" | "superseded" | "paid" | "void";
  lines: CateringQuoteLineView[];
  itemsSubtotalCents: number;
  discountCents: number;
  discountLabel: string | null;
  deliveryFeeCents: number;
  deliveryFeeTaxable: boolean;
  taxableCents: number;
  taxRate: number;
  taxCents: number;
  gratuityPercent: number | null;
  gratuityCents: number;
  totalCents: number;
  expiresAt: string;
  paymentDeadlineAt: string;
  noteToCustomer: string | null;
  supersededAt: string | null;
  supersededReason: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface CateringHistoryEntry {
  fromStatus: CateringStatus | null;
  toStatus: CateringStatus;
  at: string;
  reason: string | null;
  /** "You" / "Drincup Cafe" for customers; the admin's name for admins. */
  actor: string;
}

export interface CateringMessageView {
  id: string;
  kind: "change_request" | "cancellation_request" | "quote_note" | "note";
  authorRole: "customer" | "admin" | "system";
  author: string;
  body: string;
  at: string;
}

export interface CateringPaymentView {
  id: string;
  status: Enums<"payment_status">;
  amountCents: number;
  refundedCents: number;
  method: string | null;
  quoteId: string | null;
  at: string;
}

export interface CateringRefundView {
  id: string;
  amountCents: number;
  status: string;
  reason: string;
  failureReason: string | null;
  at: string;
}

export interface CateringRequestDetail extends CateringRequestSummary {
  userId: string | null;
  locationId: string | null;
  locationName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  deliveryAddress: string | null;
  deliveryPostalCode: string | null;
  budgetCents: number | null;
  notes: string | null;
  customDrinkRequest: string | null;
  items: { productId: string | null; name: string; sizeName: string | null; quantity: number; notes: string | null }[];
  currentQuote: CateringQuoteView | null;
  quotes: CateringQuoteView[];
  history: CateringHistoryEntry[];
  messages: CateringMessageView[];
  payments: CateringPaymentView[];
  refunds: CateringRefundView[];
  cancellationReason: string | null;
  cancellationRequestReason: string | null;
  cancellationRequestedAt: string | null;
  flaggedForReviewAt: string | null;
  reviewReason: string | null;
  updatedAt: string;
  createdByName: string | null;
  updatedByName: string | null;
}

const LIST_SELECT =
  "id, request_number, status, event_at, headcount, fulfillment, created_at, contact_name, admin_attention_at, admin_seen_at, cancellation_requested_at, current_quote:catering_quotes!catering_requests_current_quote_fk(total_cents)";

type ListRow = {
  id: string;
  request_number: string;
  status: CateringStatus;
  event_at: string;
  headcount: number;
  fulfillment: Enums<"fulfillment_type">;
  created_at: string;
  contact_name: string | null;
  admin_attention_at: string | null;
  admin_seen_at: string | null;
  cancellation_requested_at: string | null;
  current_quote: { total_cents: number } | null;
};

export function isUnread(row: { admin_attention_at: string | null; admin_seen_at: string | null }): boolean {
  if (!row.admin_attention_at) return false;
  return !row.admin_seen_at || Date.parse(row.admin_attention_at) > Date.parse(row.admin_seen_at);
}

function toSummary(row: ListRow): CateringRequestSummary {
  return {
    id: row.id,
    requestNumber: row.request_number,
    status: row.status,
    eventAt: row.event_at,
    headcount: row.headcount,
    fulfillment: row.fulfillment,
    createdAt: row.created_at,
    contactName: row.contact_name,
    totalCents: row.current_quote?.total_cents ?? null,
    isNew: isUnread(row),
    cancellationRequested: Boolean(row.cancellation_requested_at),
  };
}

/** The signed-in customer's requests, newest first. */
export async function listMyCateringRequests(userId: string): Promise<CateringRequestSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_requests")
    .select(LIST_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Catering: could not load your requests (${error.message})`);
  return ((data ?? []) as unknown as ListRow[]).map((row) => ({ ...toSummary(row), isNew: false }));
}

// ---------------------------------------------------------------------------
// The admin inbox.
// ---------------------------------------------------------------------------

export interface InboxFilters {
  status: CateringStatus | "all" | "new";
  fulfillment: "pickup" | "delivery" | "all";
  /** Event date range, Honolulu dates (YYYY-MM-DD). */
  from: string | null;
  to: string | null;
  search: string;
  page: number;
}

export const INBOX_PAGE_SIZE = 20;

export async function listCateringInbox(filters: InboxFilters): Promise<{ rows: CateringRequestSummary[]; total: number }> {
  const supabase = await createClient();
  let query = supabase.from("catering_requests").select(LIST_SELECT, { count: "exact" });

  if (filters.status === "new") query = query.not("admin_attention_at", "is", null);
  else if (filters.status !== "all") query = query.eq("status", filters.status);
  if (filters.fulfillment !== "all") query = query.eq("fulfillment", filters.fulfillment);
  if (filters.from) query = query.gte("event_at", `${filters.from}T00:00:00-10:00`);
  if (filters.to) query = query.lt("event_at", nextDayStart(filters.to));
  const term = filters.search.trim().replace(/[%_,()*\\]/g, " ").trim();
  if (term) query = query.or(`request_number.ilike.%${term}%,contact_name.ilike.%${term}%,contact_email.ilike.%${term}%`);

  // "New" is computed (attention after the last look), so that view is
  // filtered after reading; it is small by nature.
  if (filters.status === "new") {
    const { data, error } = await query.order("admin_attention_at", { ascending: false }).limit(200);
    if (error) throw new Error(`Catering inbox: ${error.message}`);
    const rows = ((data ?? []) as unknown as ListRow[]).filter(isUnread).map(toSummary);
    const start = (filters.page - 1) * INBOX_PAGE_SIZE;
    return { rows: rows.slice(start, start + INBOX_PAGE_SIZE), total: rows.length };
  }

  const start = (filters.page - 1) * INBOX_PAGE_SIZE;
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(start, start + INBOX_PAGE_SIZE - 1);
  if (error) throw new Error(`Catering inbox: ${error.message}`);
  return { rows: ((data ?? []) as unknown as ListRow[]).map(toSummary), total: count ?? 0 };
}

function nextDayStart(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${next.toISOString().slice(0, 10)}T00:00:00-10:00`;
}

/** Requests needing a look: the admin home's count and the nav badge. */
export async function countNewCateringRequests(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catering_requests")
    .select("admin_attention_at, admin_seen_at")
    .not("admin_attention_at", "is", null)
    .order("admin_attention_at", { ascending: false })
    .limit(500);
  return (data ?? []).filter(isUnread).length;
}

export interface CalendarEntry {
  id: string;
  requestNumber: string;
  status: CateringStatus;
  eventAt: string;
  headcount: number;
  contactName: string | null;
  fulfillment: Enums<"fulfillment_type">;
}

/** Quoted and confirmed (and fulfilled) events in [from, to). */
export async function listCateringCalendar(from: Date, to: Date): Promise<CalendarEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("catering_requests")
    .select("id, request_number, status, event_at, headcount, contact_name, fulfillment")
    .in("status", ["quoted", "confirmed", "fulfilled"])
    .gte("event_at", from.toISOString())
    .lt("event_at", to.toISOString())
    .order("event_at");
  if (error) throw new Error(`Catering calendar: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    requestNumber: row.request_number,
    status: row.status,
    eventAt: row.event_at,
    headcount: row.headcount,
    contactName: row.contact_name,
    fulfillment: row.fulfillment,
  }));
}

// ---------------------------------------------------------------------------
// One request, in full.
// ---------------------------------------------------------------------------

const DETAIL_SELECT = `
  id, request_number, status, event_at, headcount, fulfillment, created_at, updated_at, user_id, location_id,
  contact_name, contact_email, contact_phone, delivery_address, delivery_postal_code, budget_cents, notes,
  custom_drink_request, cancellation_reason, cancellation_request_reason, cancellation_requested_at,
  admin_attention_at, admin_seen_at, flagged_for_review_at, review_reason, current_quote_id, created_by, updated_by,
  location:locations(name),
  items:catering_request_items(product_id, product_name, size_name, quantity, notes, created_at),
  quotes:catering_quotes!catering_quotes_catering_request_id_fkey(
    id, version, status, items_subtotal_cents, discount_cents, discount_label, delivery_fee_cents, delivery_fee_taxable,
    taxable_cents, tax_rate, tax_cents, gratuity_percent, gratuity_cents, total_cents, expires_at, payment_deadline_at,
    note_to_customer, superseded_at, superseded_reason, created_at, created_by,
    lines:catering_quote_lines(kind, product_id, product_size_id, description, size_name, quantity, unit_price_cents, line_total_cents, sort_order)
  ),
  history:catering_status_history(from_status, to_status, changed_by, reason, created_at),
  messages:catering_messages(id, kind, author_role, author_id, body, created_at),
  payments(id, status, amount_cents, refunded_cents, method_brand, method_last4, method_wallet, catering_quote_id, created_at),
  refunds(id, amount_cents, status, reason, failure_reason, created_at)
`;

type DetailRow = ListRow & {
  updated_at: string;
  user_id: string | null;
  location_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  delivery_address: string | null;
  delivery_postal_code: string | null;
  budget_cents: number | null;
  notes: string | null;
  custom_drink_request: string | null;
  cancellation_reason: string | null;
  cancellation_request_reason: string | null;
  flagged_for_review_at: string | null;
  review_reason: string | null;
  current_quote_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  location: { name: string } | null;
  items: { product_id: string | null; product_name: string; size_name: string | null; quantity: number; notes: string | null; created_at: string }[];
  quotes: {
    id: string;
    version: number;
    status: CateringQuoteView["status"];
    items_subtotal_cents: number;
    discount_cents: number;
    discount_label: string | null;
    delivery_fee_cents: number;
    delivery_fee_taxable: boolean;
    taxable_cents: number;
    tax_rate: number;
    tax_cents: number;
    gratuity_percent: number | null;
    gratuity_cents: number;
    total_cents: number;
    expires_at: string;
    payment_deadline_at: string;
    note_to_customer: string | null;
    superseded_at: string | null;
    superseded_reason: string | null;
    created_at: string;
    created_by: string | null;
    lines: {
      kind: "product" | "custom";
      product_id: string | null;
      product_size_id: string | null;
      description: string;
      size_name: string | null;
      quantity: number;
      unit_price_cents: number;
      line_total_cents: number;
      sort_order: number;
    }[];
  }[];
  history: { from_status: CateringStatus | null; to_status: CateringStatus; changed_by: string | null; reason: string | null; created_at: string }[];
  messages: { id: string; kind: CateringMessageView["kind"]; author_role: CateringMessageView["authorRole"]; author_id: string | null; body: string; created_at: string }[];
  payments: {
    id: string;
    status: Enums<"payment_status">;
    amount_cents: number;
    refunded_cents: number;
    method_brand: string | null;
    method_last4: string | null;
    method_wallet: string | null;
    catering_quote_id: string | null;
    created_at: string;
  }[];
  refunds: { id: string; amount_cents: number; status: string; reason: string; failure_reason: string | null; created_at: string }[];
};

export const CAFE_NAME_FOR_CUSTOMERS = "Drincup Cafe";

/**
 * One request, read as the signed-in user. Null when RLS hides it (not
 * theirs) or it does not exist. `viewer` decides how actors are named:
 * customers see "You" and "Drincup Cafe", admins see names.
 */
export async function getCateringRequest(
  requestId: string,
  viewer: { id: string; role: "customer" | "staff" | "admin" },
): Promise<CateringRequestDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("catering_requests").select(DETAIL_SELECT).eq("id", requestId).maybeSingle();
  if (error) throw new Error(`Catering: could not load the request (${error.message})`);
  if (!data) return null;
  const row = data as unknown as DetailRow;
  const isAdmin = viewer.role === "admin";

  // Admins see who did what; RLS lets only them read other profiles.
  const actorIds = new Set<string>();
  if (isAdmin) {
    for (const id of [row.created_by, row.updated_by, ...row.history.map((h) => h.changed_by), ...row.quotes.map((q) => q.created_by), ...row.messages.map((m) => m.author_id)]) {
      if (id) actorIds.add(id);
    }
  }
  const names = new Map<string, string>();
  if (actorIds.size > 0) {
    const { data: people } = await supabase.from("profiles").select("id, full_name, first_name, email, role").in("id", [...actorIds]);
    for (const p of people ?? []) {
      const name = p.full_name ?? p.first_name ?? p.email ?? "Someone";
      names.set(p.id, p.role === "customer" ? `${name} (customer)` : `${name} (${p.role})`);
    }
  }
  const actorName = (id: string | null): string => {
    if (!id) return isAdmin ? "System" : CAFE_NAME_FOR_CUSTOMERS;
    if (!isAdmin) return id === viewer.id ? "You" : CAFE_NAME_FOR_CUSTOMERS;
    return names.get(id) ?? "Someone";
  };

  const quotes: CateringQuoteView[] = [...row.quotes]
    .sort((a, b) => b.version - a.version)
    .map((q) => ({
      id: q.id,
      version: q.version,
      status: q.status,
      lines: [...q.lines]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({
          kind: l.kind,
          productId: l.product_id,
          sizeId: l.product_size_id,
          description: l.description,
          sizeName: l.size_name,
          quantity: l.quantity,
          unitPriceCents: l.unit_price_cents,
          lineTotalCents: l.line_total_cents,
        })),
      itemsSubtotalCents: q.items_subtotal_cents,
      discountCents: q.discount_cents,
      discountLabel: q.discount_label,
      deliveryFeeCents: q.delivery_fee_cents,
      deliveryFeeTaxable: q.delivery_fee_taxable,
      taxableCents: q.taxable_cents,
      taxRate: Number(q.tax_rate),
      taxCents: q.tax_cents,
      gratuityPercent: q.gratuity_percent === null ? null : Number(q.gratuity_percent),
      gratuityCents: q.gratuity_cents,
      totalCents: q.total_cents,
      expiresAt: q.expires_at,
      paymentDeadlineAt: q.payment_deadline_at,
      noteToCustomer: q.note_to_customer,
      supersededAt: q.superseded_at,
      supersededReason: q.superseded_reason,
      createdAt: q.created_at,
      createdByName: isAdmin ? actorName(q.created_by) : null,
    }));

  return {
    ...toSummary(row),
    isNew: isAdmin && isUnread(row),
    userId: row.user_id,
    locationId: row.location_id,
    locationName: row.location?.name ?? null,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    deliveryAddress: row.delivery_address,
    deliveryPostalCode: row.delivery_postal_code,
    budgetCents: row.budget_cents,
    notes: row.notes,
    customDrinkRequest: row.custom_drink_request,
    items: [...row.items]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((i) => ({ productId: i.product_id, name: i.product_name, sizeName: i.size_name, quantity: i.quantity, notes: i.notes })),
    currentQuote: quotes.find((q) => q.id === row.current_quote_id) ?? null,
    quotes,
    history: [...row.history]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((h) => ({ fromStatus: h.from_status, toStatus: h.to_status, at: h.created_at, reason: h.reason, actor: actorName(h.changed_by) })),
    messages: [...row.messages]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        authorRole: m.author_role,
        author: m.author_role === "customer" ? (isAdmin ? actorName(m.author_id) : "You") : isAdmin ? actorName(m.author_id) : CAFE_NAME_FOR_CUSTOMERS,
        body: m.body,
        at: m.created_at,
      })),
    payments: [...row.payments]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => ({
        id: p.id,
        status: p.status,
        amountCents: p.amount_cents,
        refundedCents: p.refunded_cents,
        method: paymentMethodLabel({ brand: p.method_brand, last4: p.method_last4, wallet: p.method_wallet }),
        quoteId: p.catering_quote_id,
        at: p.created_at,
      })),
    refunds: [...row.refunds]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((r) => ({ id: r.id, amountCents: r.amount_cents, status: r.status, reason: r.reason, failureReason: r.failure_reason, at: r.created_at })),
    cancellationReason: row.cancellation_reason,
    cancellationRequestReason: row.cancellation_request_reason,
    cancellationRequestedAt: row.cancellation_requested_at,
    flaggedForReviewAt: row.flagged_for_review_at,
    reviewReason: row.review_reason,
    updatedAt: row.updated_at,
    createdByName: isAdmin ? actorName(row.created_by) : null,
    updatedByName: isAdmin && row.updated_by ? actorName(row.updated_by) : null,
  };
}

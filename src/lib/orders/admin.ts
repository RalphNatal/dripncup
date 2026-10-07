import "server-only";

/**
 * Orders for the admin: search, and everything about one order -- what the
 * ticket and receipt show, plus payments (brand and last four only),
 * refunds, status history with who did it, the emails it sent and its
 * points. Read as the signed-in admin (RLS lets admins read every order).
 */
import { refundableCents } from "@/lib/payments/refunds";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

import { ORDER_DETAIL_SELECT, paymentMethodLabel, toOrderDetail, type OrderDetail, type OrderDetailRow } from "./detail";

export const ORDER_STATUS_LABEL: Record<Enums<"order_status">, string> = {
  pending_payment: "Unpaid",
  placed: "Placed",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  picked_up: "Picked up",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export interface AdminOrderRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  placedAt: string | null;
  status: Enums<"order_status">;
  locationName: string;
  customerName: string | null;
  customerEmail: string | null;
  totalCents: number;
  refundedCents: number;
  paymentState: string;
  flagged: boolean;
}

export interface OrderSearch {
  q?: string;
  from?: string;
  to?: string;
  locationId?: string;
  status?: Enums<"order_status">;
  payment?: string;
  page: number;
}

export async function searchOrders(filters: OrderSearch, pageSize = 25): Promise<{ rows: AdminOrderRow[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_orders", {
    p_query: filters.q || undefined,
    p_from: filters.from,
    p_to: filters.to,
    p_location_id: filters.locationId,
    p_status: filters.status,
    p_payment: filters.payment,
    p_limit: pageSize,
    p_offset: (filters.page - 1) * pageSize,
  });
  if (error) throw new Error(`Orders: ${error.message}`);
  return {
    total: Number(data?.[0]?.total_count ?? 0),
    rows: (data ?? []).map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      createdAt: o.created_at,
      placedAt: o.placed_at,
      status: o.status,
      locationName: o.location_name,
      customerName: o.customer_name,
      customerEmail: o.customer_email,
      totalCents: o.total_cents,
      refundedCents: Number(o.refunded_cents),
      paymentState: o.payment_state,
      flagged: o.flagged,
    })),
  };
}

export interface AdminOrderDetail {
  order: OrderDetail;
  customer: { id: string | null; name: string | null; email: string | null; phone: string | null; anonymized: boolean };
  review: { reason: string | null; flaggedAt: string | null; resolvedAt: string | null; note: string | null };
  notes: string | null;
  refundableCents: number;
  payments: { status: string; amountCents: number; refundedCents: number; method: string | null; createdAt: string; failure: string | null }[];
  refunds: { id: string; amountCents: number; status: string; reason: string; failureReason: string | null; createdAt: string; by: string | null; handledNote: string | null }[];
  history: { from: string | null; to: string; at: string; by: string | null; role: string | null; reason: string | null }[];
  emails: { id: string; kind: string; status: string; attempts: number; sentAt: string | null; lastError: string | null; createdAt: string; dismissedNote: string | null }[];
  points: { type: string; points: number; at: string; description: string | null }[];
}

export async function getAdminOrder(id: string): Promise<AdminOrderDetail | null> {
  const supabase = await createClient();
  const { data: row } = await supabase.from("orders").select(ORDER_DETAIL_SELECT).eq("id", id).maybeSingle();
  if (!row) return null;
  const [{ data: extra }, { data: payments }, { data: refunds }, { data: history }, { data: emails }, { data: points }, refundable] = await Promise.all([
    supabase
      .from("orders")
      .select("user_id, customer_first_name, customer_email, customer_phone, notes, anonymized_at, review_reason, flagged_for_review_at, review_resolved_at, review_note, profile:profiles!orders_user_id_fkey(full_name, email, phone)")
      .eq("id", id)
      .single(),
    supabase.from("payments").select("status, amount_cents, refunded_cents, method_brand, method_last4, method_wallet, created_at, failure_message").eq("order_id", id).order("created_at"),
    supabase.from("refunds").select("id, amount_cents, status, reason, failure_reason, created_at, requested_by, handled_note").eq("order_id", id).order("created_at"),
    supabase.from("order_status_history").select("from_status, to_status, created_at, changed_by, reason").eq("order_id", id).order("created_at"),
    supabase.from("email_outbox").select("id, kind, status, attempts, sent_at, last_error, created_at, dismissed_note").eq("order_id", id).order("created_at"),
    supabase.from("loyalty_transactions").select("type, points, created_at, description").eq("order_id", id).order("created_at"),
    refundableCents({ kind: "order", orderId: id }),
  ]);
  const peopleIds = [...new Set([...(history ?? []).map((h) => h.changed_by), ...(refunds ?? []).map((r) => r.requested_by)].filter((x): x is string => Boolean(x)))];
  const { data: people } = peopleIds.length ? await supabase.from("profiles").select("id, full_name, email, role").in("id", peopleIds) : { data: [] };
  const who = (pid: string | null) => {
    const p = people?.find((x) => x.id === pid);
    return p ? { name: p.full_name || p.email, role: p.role } : null;
  };
  const profile = extra?.profile ?? null;

  return {
    order: toOrderDetail(row as unknown as OrderDetailRow),
    customer: {
      id: extra?.user_id ?? null,
      name: profile?.full_name ?? extra?.customer_first_name ?? null,
      email: profile?.email ?? extra?.customer_email ?? null,
      phone: profile?.phone ?? extra?.customer_phone ?? null,
      anonymized: Boolean(extra?.anonymized_at),
    },
    review: { reason: extra?.review_reason ?? null, flaggedAt: extra?.flagged_for_review_at ?? null, resolvedAt: extra?.review_resolved_at ?? null, note: extra?.review_note ?? null },
    notes: extra?.notes ?? null,
    refundableCents: refundable,
    payments: (payments ?? []).map((p) => ({
      status: p.status,
      amountCents: p.amount_cents,
      refundedCents: p.refunded_cents,
      // Brand and last four only (and the wallet): never card data.
      method: paymentMethodLabel({ brand: p.method_brand, last4: p.method_last4, wallet: p.method_wallet }),
      createdAt: p.created_at,
      failure: p.failure_message,
    })),
    refunds: (refunds ?? []).map((r) => ({
      id: r.id,
      amountCents: r.amount_cents,
      status: r.status,
      reason: r.reason,
      failureReason: r.failure_reason,
      createdAt: r.created_at,
      by: who(r.requested_by)?.name ?? null,
      handledNote: r.handled_note,
    })),
    history: (history ?? []).map((h) => ({ from: h.from_status, to: h.to_status, at: h.created_at, by: who(h.changed_by)?.name ?? null, role: who(h.changed_by)?.role ?? null, reason: h.reason })),
    emails: (emails ?? []).map((e) => ({ id: e.id, kind: e.kind, status: e.status, attempts: e.attempts, sentAt: e.sent_at, lastError: e.last_error, createdAt: e.created_at, dismissedNote: e.dismissed_note })),
    points: (points ?? []).map((p) => ({ type: p.type, points: p.points, at: p.created_at, description: p.description })),
  };
}

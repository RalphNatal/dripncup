import "server-only";

/**
 * The admin home's "Needs attention" queue: everything that needs a person,
 * from admin_attention_items() (the definitions live there). Each item
 * links to its detail page and leaves the queue once resolved.
 */
import { cache } from "react";

import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export type AttentionKind = "flagged_order" | "flagged_catering" | "failed_refund" | "failed_email" | "catering" | "stuck_unpaid";

export interface AttentionItem {
  kind: AttentionKind;
  id: string;
  title: string;
  detail: string | null;
  occurredAt: string | null;
  orderId: string | null;
  cateringRequestId: string | null;
  amountCents: number | null;
  href: string;
}

export const ATTENTION_LABELS: Record<AttentionKind, string> = {
  flagged_order: "Payment mismatch",
  flagged_catering: "Catering payment mismatch",
  failed_refund: "Failed refund",
  failed_email: "Failed email",
  catering: "Catering",
  stuck_unpaid: "Stuck unpaid order",
};

function hrefFor(row: { kind: string; order_id: string | null; catering_request_id: string | null }): string {
  if (row.order_id) return `/admin/orders/${row.order_id}`;
  if (row.catering_request_id) return `/admin/catering/${row.catering_request_id}`;
  return "/admin";
}

/** Deduped per request: the layout's badge and the home page share one call. */
export const listAttentionItems = cache(async (): Promise<AttentionItem[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_attention_items");
  if (error) {
    logError("admin.attention_load_failed", error);
    return [];
  }
  return (data ?? []).map((row) => ({
    kind: row.kind as AttentionKind,
    id: row.id,
    title: row.title,
    detail: row.detail,
    occurredAt: row.occurred_at,
    orderId: row.order_id,
    cateringRequestId: row.catering_request_id,
    amountCents: row.amount_cents,
    href: hrefFor(row),
  }));
});

import "server-only";

/**
 * The signed-in customer's orders, read with their own session (RLS) and,
 * for one order, checked against their id as well: staff can read orders at
 * their location, but a customer's tracker and receipt are the customer's.
 */
import { cache } from "react";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

import { ORDER_DETAIL_SELECT, toOrderDetail, type OrderDetail, type OrderDetailRow } from "./detail";
import { PAST_ORDERS_PAGE_SIZE, decodeOrdersCursor, encodeOrdersCursor, toOrderListItem, type OrderListItem } from "./list";

/** Null for anyone but the order's owner, so a page can answer 404. */
export async function getOwnOrderDetail(orderId: string): Promise<OrderDetail | null> {
  if (!z.guid().safeParse(orderId).success) return null;
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("orders").select(ORDER_DETAIL_SELECT).eq("id", orderId).maybeSingle();
  const row = data as unknown as OrderDetailRow | null;
  if (!row || row.user_id !== profile.id) return null;
  return toOrderDetail(row);
}

/**
 * The signed-in customer's orders in Placed through Ready (never an unpaid
 * or abandoned checkout: `list_my_orders` 'active' scope). Cached per
 * request: the shop layout (the Orders-tab dot) and Home or /orders (the
 * cards) seed the same client query, so they must render the same list.
 */
export const listActiveOrders = cache(async (): Promise<OrderListItem[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_orders", { p_scope: "active", p_limit: 20 });
  if (error) throw new Error(`Could not load active orders: ${error.message}`);
  return (data ?? []).map(toOrderListItem);
});

export interface PastOrdersPage {
  orders: OrderListItem[];
  /** Pass back for the next page; null when there are no more. */
  nextCursor: string | null;
}

export async function listPastOrders(cursor?: string | null, limit = PAST_ORDERS_PAGE_SIZE): Promise<PastOrdersPage> {
  const after = decodeOrdersCursor(cursor);
  const supabase = await createClient();
  // One extra row says whether there is another page.
  const { data, error } = await supabase.rpc("list_my_orders", {
    p_scope: "past",
    p_before_created_at: after?.createdAt,
    p_before_id: after?.id,
    p_limit: limit + 1,
  });
  if (error) throw new Error(`Could not load past orders: ${error.message}`);
  const rows = (data ?? []).map(toOrderListItem);
  const orders = rows.slice(0, limit);
  return { orders, nextCursor: rows.length > limit ? encodeOrdersCursor(orders[orders.length - 1]) : null };
}

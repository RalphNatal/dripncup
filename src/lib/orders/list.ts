/**
 * Rows for the order history, the active-order cards and the Orders tab dot,
 * from `list_my_orders()`. Isomorphic: the server renders the first page and
 * the browser refetches with the customer's own session.
 */
import type { OrderStatus } from "@/lib/order-status";

import { itemSummary } from "./detail";

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: string;
  placedAt: string | null;
  readyAt: string | null;
  pickupType: "asap" | "scheduled";
  scheduledFor: string | null;
  estimatedReadyAt: string | null;
  locationId: string;
  locationName: string;
  totalCents: number;
  /** "Latte + 2 more" */
  summary: string;
}

/** One row of `list_my_orders`, as PostgREST returns it. */
export interface OrderListRow {
  id: string;
  order_number: string;
  status: OrderStatus;
  created_at: string;
  placed_at: string | null;
  ready_at: string | null;
  pickup_type: "asap" | "scheduled";
  scheduled_for: string | null;
  estimated_ready_at: string | null;
  location_id: string;
  location_name: string;
  total_cents: number;
  items: unknown;
}

function items(value: unknown): { name: string; quantity: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item && typeof item === "object" && typeof item.name === "string"
      ? [{ name: item.name as string, quantity: Number(item.quantity) || 1 }]
      : [],
  );
}

export function toOrderListItem(row: OrderListRow): OrderListItem {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    createdAt: row.created_at,
    placedAt: row.placed_at,
    readyAt: row.ready_at,
    pickupType: row.pickup_type,
    scheduledFor: row.scheduled_for,
    estimatedReadyAt: row.estimated_ready_at,
    locationId: row.location_id,
    locationName: row.location_name,
    totalCents: row.total_cents,
    summary: itemSummary(items(row.items)),
  };
}

/** Opaque "load more" cursor: the last row's created_at and id. */
export function encodeOrdersCursor(item: Pick<OrderListItem, "createdAt" | "id">): string {
  return `${item.createdAt}|${item.id}`;
}

export function decodeOrdersCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { createdAt, id };
}

export const PAST_ORDERS_PAGE_SIZE = 10;

"use client";

/**
 * The staff dashboard's reads and writes, made in the browser with the
 * barista's own session. RLS and the definer functions decide what is
 * allowed; nothing here is trusted to enforce anything.
 *
 * Writes never queue up for later. If the device is offline, or the request
 * fails, the caller gets an error to show and the barista taps again: an
 * order is never silently marked ready (or not) behind their back.
 */
import type { PostgrestError } from "@supabase/supabase-js";

import { isProductAvailableAt } from "@/lib/menu/availability-window";
import type { Allergen } from "@/lib/menu/model";
import type { SnapshotModifier } from "@/lib/orders/detail";
import type { OrderStatus } from "@/lib/order-status";
import { createClient } from "@/lib/supabase/client";

import type { StaffOrder } from "./queue";
import type { CatalogMeta } from "./ticket";
import type { LiveLocationState } from "./types";

const ORDER_SELECT = `
  id, order_number, status, customer_first_name, notes, pickup_type, scheduled_for, estimated_ready_at,
  created_at, placed_at, accepted_at, preparing_at, ready_at, picked_up_at, cancelled_at, cancellation_reason,
  order_items(id, product_id, product_name, size_name, quantity, modifiers, special_instructions, created_at),
  order_rewards(reward_name, reward_type, order_item_id, option_name)
`;

type OrderRow = {
  id: string;
  order_number: string;
  status: OrderStatus;
  customer_first_name: string | null;
  notes: string | null;
  pickup_type: "asap" | "scheduled";
  scheduled_for: string | null;
  estimated_ready_at: string | null;
  created_at: string;
  placed_at: string | null;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  order_items:
    | {
        id: string;
        product_id: string | null;
        product_name: string;
        size_name: string | null;
        quantity: number;
        modifiers: unknown;
        special_instructions: string | null;
        created_at: string;
      }[]
    | null;
  order_rewards: { reward_name: string; reward_type: string; order_item_id: string | null; option_name: string | null }[] | null;
};

function toStaffOrder(row: OrderRow): StaffOrder {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    cupName: row.customer_first_name,
    notes: row.notes?.trim() ? row.notes.trim() : null,
    pickupType: row.pickup_type,
    scheduledFor: row.scheduled_for,
    estimatedReadyAt: row.estimated_ready_at,
    createdAt: row.created_at,
    placedAt: row.placed_at,
    acceptedAt: row.accepted_at,
    preparingAt: row.preparing_at,
    readyAt: row.ready_at,
    pickedUpAt: row.picked_up_at,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    items: [...(row.order_items ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((item) => ({
        id: item.id,
        productId: item.product_id,
        name: item.product_name,
        sizeName: item.size_name,
        quantity: item.quantity,
        modifiers: Array.isArray(item.modifiers)
          ? (item.modifiers.filter((m) => m && typeof m === "object") as SnapshotModifier[])
          : [],
        specialInstructions: item.special_instructions?.trim() ? item.special_instructions.trim() : null,
        rewards: (row.order_rewards ?? [])
          .filter((reward) => reward.order_item_id === item.id)
          .map((reward) =>
            reward.reward_type === "free_modifier" && reward.option_name ? `${reward.reward_name}: ${reward.option_name}` : reward.reward_name,
          ),
      })),
  };
}

/**
 * The queue (placed through ready, whenever placed) plus everything placed,
 * picked up or cancelled today, for the summary strip and the completed
 * drawer. Unpaid checkouts never appear.
 */
export async function fetchStaffOrders(locationId: string, todayStart: Date): Promise<StaffOrder[]> {
  const since = todayStart.toISOString();
  const { data, error } = await createClient()
    .from("orders")
    .select(ORDER_SELECT)
    .eq("location_id", locationId)
    .neq("status", "pending_payment")
    .or(`status.in.(placed,accepted,preparing,ready),placed_at.gte.${since},picked_up_at.gte.${since},cancelled_at.gte.${since}`)
    .order("placed_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as OrderRow[]).map(toStaffOrder);
}

/** Group build order and allergens for every product and option, to lay tickets out. */
export async function fetchCatalogMeta(): Promise<CatalogMeta> {
  const supabase = createClient();
  const [groups, products, options] = await Promise.all([
    supabase.from("modifier_groups").select("id, slug, name, sort_order"),
    supabase.from("products").select("id, allergens"),
    supabase.from("modifier_options").select("id, allergens"),
  ]);
  for (const result of [groups, products, options]) if (result.error) throw new Error(result.error.message);
  return {
    groups: Object.fromEntries((groups.data ?? []).map((g) => [g.id, { slug: g.slug, name: g.name, sortOrder: g.sort_order }])),
    productAllergens: Object.fromEntries(
      (products.data ?? []).filter((p) => p.allergens.length).map((p) => [p.id, p.allergens as Allergen[]]),
    ),
    optionAllergens: Object.fromEntries(
      (options.data ?? []).filter((o) => o.allergens.length).map((o) => [o.id, o.allergens as Allergen[]]),
    ),
  };
}

/** The pause toggle and the global switch, re-read while the dashboard is open. */
export async function fetchLocationState(locationId: string): Promise<LiveLocationState> {
  const supabase = createClient();
  const [location, setting] = await Promise.all([
    supabase.from("locations").select("accepting_orders, paused_until, paused_at").eq("id", locationId).single(),
    supabase.from("settings").select("value").eq("key", "orders.accepting_online_orders").maybeSingle(),
  ]);
  if (location.error) throw new Error(location.error.message);
  return {
    acceptingOrders: location.data.accepting_orders,
    pausedUntil: location.data.paused_until,
    pausedAt: location.data.paused_at,
    onlineOrderingEnabled: typeof setting.data?.value === "boolean" ? setting.data.value : true,
  };
}

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

export type ActionResult =
  | { outcome: "done" }
  /** Someone else moved the order first; the screen should refresh. */
  | { outcome: "already"; status: OrderStatus | null }
  | { outcome: "error"; message: string };

const OFFLINE_MESSAGE = "You're offline, so nothing was saved. Tap again once the connection is back.";

function failure(error: PostgrestError | Error | null, fallback: string): ActionResult {
  const message = error?.message ?? "";
  if (typeof navigator !== "undefined" && !navigator.onLine) return { outcome: "error", message: OFFLINE_MESSAGE };
  if (/fetch|network|load failed/i.test(message)) {
    return { outcome: "error", message: "Couldn't reach the server, so nothing was saved. Try again." };
  }
  return { outcome: "error", message: fallback };
}

/**
 * One tap on a ticket: `from` is the status the barista saw, `to` the move.
 * If the order is no longer at `from` (a second device got there first, or
 * it was cancelled), nothing is sent and the caller says "Already updated".
 * Should both devices pass that check at once, advance_order_status treats
 * the repeat as a no-op, so neither sees an error.
 */
export async function advanceOrder(orderId: string, from: OrderStatus, to: OrderStatus): Promise<ActionResult> {
  if (!navigator.onLine) return { outcome: "error", message: OFFLINE_MESSAGE };
  const supabase = createClient();

  const current = await supabase.from("orders").select("status").eq("id", orderId).maybeSingle();
  if (current.error) return failure(current.error, "Couldn't update the order. Try again.");
  if (!current.data) return { outcome: "error", message: "That order is no longer available." };
  if (current.data.status !== from) return { outcome: "already", status: current.data.status };

  const { error } = await supabase.rpc("advance_order_status", { p_order_id: orderId, p_new_status: to });
  if (!error) return { outcome: "done" };
  // The order moved between the check and the call.
  if (error.code === "23514") return { outcome: "already", status: null };
  if (error.code === "42501") return { outcome: "error", message: "You're not rostered at this location." };
  return failure(error, "Couldn't update the order. Try again.");
}

export type CancelResult =
  | { outcome: "done"; refundedCents: number; refundFailed: boolean }
  | { outcome: "already" }
  | { outcome: "error"; message: string };

/** Cancel through the server's cancel-with-refund flow, the only way a paid order can be cancelled. */
export async function cancelOrder(orderId: string, reason: string): Promise<CancelResult> {
  if (!navigator.onLine) return { outcome: "error", message: OFFLINE_MESSAGE };
  let response: Response;
  try {
    response = await fetch(`/api/staff/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  } catch {
    return { outcome: "error", message: "Couldn't reach the server, so the order was not cancelled. Try again." };
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    refund?: { ok: boolean; amountCents?: number; reason?: string };
  };
  if (response.status === 409) return { outcome: "already" };
  if (!response.ok) return { outcome: "error", message: body.error ?? "Couldn't cancel the order." };
  const refund = body.refund;
  return {
    outcome: "done",
    refundedCents: refund?.ok ? (refund.amountCents ?? 0) : 0,
    refundFailed: refund?.ok === false && refund.reason === "failed",
  };
}

export interface OrderActivity {
  history: {
    fromStatus: OrderStatus | null;
    toStatus: OrderStatus;
    at: string;
    reason: string | null;
    actorName: string | null;
    actorRole: "customer" | "staff" | "admin" | null;
  }[];
  refundableCents: number;
}

/** A ticket's status history with names, and what a cancel would refund. */
export async function fetchOrderActivity(orderId: string): Promise<OrderActivity> {
  const { data, error } = await createClient().rpc("staff_order_activity", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  const value = (data ?? {}) as {
    history?: { from_status: OrderStatus | null; to_status: OrderStatus; at: string; reason: string | null; actor_name: string | null; actor_role: OrderActivity["history"][number]["actorRole"] }[];
    refundable_cents?: number;
  };
  return {
    history: (value.history ?? []).map((h) => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      at: h.at,
      reason: h.reason,
      actorName: h.actor_name,
      actorRole: h.actor_role,
    })),
    refundableCents: Number(value.refundable_cents ?? 0),
  };
}

/** Pause (optionally until `resumeAt`) or resume online orders at a location. */
export async function setAcceptingOrders(locationId: string, accepting: boolean, resumeAt: Date | null): Promise<ActionResult> {
  if (!navigator.onLine) return { outcome: "error", message: OFFLINE_MESSAGE };
  const { error } = await createClient().rpc("set_location_accepting_orders", {
    target_location_id: locationId,
    accepting,
    resume_at: resumeAt ? resumeAt.toISOString() : undefined,
  });
  return error ? failure(error, accepting ? "Couldn't resume online orders." : "Couldn't pause online orders.") : { outcome: "done" };
}

// ---------------------------------------------------------------------------
// Sold out.
// ---------------------------------------------------------------------------

export interface SellableItem {
  kind: "product" | "option";
  id: string;
  name: string;
  /** Category for a product, modifier group for an option. */
  group: string;
}

export interface AvailabilityFlag {
  productId: string | null;
  optionId: string | null;
  /** When it resets by itself; null = until someone turns it back on. */
  availableFrom: string | null;
}

/**
 * What can be marked sold out here: the location's products (a pop-up's own
 * menu) and every option. A limited-time product outside its window is not
 * on the menu, so it is not listed either.
 */
export async function fetchSellables(location: { id: string; type: "cafe" | "event" }, now: Date = new Date()): Promise<SellableItem[]> {
  const supabase = createClient();
  const [products, options, eventMenu] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, is_active, sort_order, available_from, available_until, category:categories(name, sort_order)")
      .eq("is_active", true),
    supabase
      .from("modifier_options")
      .select("id, name, is_active, sort_order, group:modifier_groups(name, sort_order, is_active)")
      .eq("is_active", true),
    location.type === "event"
      ? supabase.from("event_menu_items").select("product_id").eq("location_id", location.id)
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const result of [products, options, eventMenu]) if (result.error) throw new Error(result.error.message);

  const onMenu = eventMenu.data ? new Set(eventMenu.data.map((row) => row.product_id)) : null;
  const productItems = (products.data ?? [])
    .filter((p) => (!onMenu || onMenu.has(p.id)) && isProductAvailableAt(p, now))
    .sort((a, b) => (a.category?.sort_order ?? 0) - (b.category?.sort_order ?? 0) || a.sort_order - b.sort_order)
    .map((p): SellableItem => ({ kind: "product", id: p.id, name: p.name, group: p.category?.name ?? "Menu" }));
  const optionItems = (options.data ?? [])
    .filter((o) => o.group?.is_active !== false)
    .sort((a, b) => (a.group?.sort_order ?? 0) - (b.group?.sort_order ?? 0) || a.sort_order - b.sort_order)
    .map((o): SellableItem => ({ kind: "option", id: o.id, name: o.name, group: o.group?.name ?? "Options" }));
  return [...productItems, ...optionItems];
}

export async function fetchAvailability(locationId: string): Promise<AvailabilityFlag[]> {
  const { data, error } = await createClient()
    .from("location_availability")
    .select("product_id, modifier_option_id, is_available, available_from")
    .eq("location_id", locationId);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => !row.is_available)
    .map((row) => ({ productId: row.product_id, optionId: row.modifier_option_id, availableFrom: row.available_from }));
}

export async function setSoldOut(
  locationId: string,
  item: Pick<SellableItem, "kind" | "id">,
  soldOut: boolean,
  until: string | null,
): Promise<ActionResult> {
  if (!navigator.onLine) return { outcome: "error", message: OFFLINE_MESSAGE };
  const { error } = await createClient().rpc("set_sold_out", {
    p_location_id: locationId,
    p_product_id: item.kind === "product" ? item.id : undefined,
    p_modifier_option_id: item.kind === "option" ? item.id : undefined,
    p_sold_out: soldOut,
    p_until: until ?? undefined,
  });
  return error ? failure(error, "Couldn't change that item. Try again.") : { outcome: "done" };
}

// ---------------------------------------------------------------------------
// Catering prep list.
// ---------------------------------------------------------------------------

export interface CateringPrep {
  id: string;
  requestNumber: string;
  status: "confirmed" | "fulfilled";
  eventAt: string;
  headcount: number;
  fulfillment: "pickup" | "delivery";
  deliveryAddress: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  customDrinkRequest: string | null;
  /** The paid quote's lines (what was sold), or what was asked for if there are none. */
  items: { name: string; size: string | null; quantity: number; notes: string | null }[];
}

/** Confirmed (and fulfilled) catering at this counter on one Honolulu date ("YYYY-MM-DD"). */
export async function fetchCateringPrep(locationId: string, day: string): Promise<CateringPrep[]> {
  const { data, error } = await createClient().rpc("staff_catering_prep", { p_location_id: locationId, p_day: day });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    requestNumber: row.request_number,
    status: row.status === "fulfilled" ? "fulfilled" : "confirmed",
    eventAt: row.event_at,
    headcount: row.headcount,
    fulfillment: row.fulfillment,
    deliveryAddress: row.delivery_address,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    notes: row.notes,
    customDrinkRequest: row.custom_drink_request,
    items: Array.isArray(row.items) ? (row.items as CateringPrep["items"]) : [],
  }));
}

/** After the event: catering_mark_fulfilled checks the counter and that the day has come. */
export async function markCateringFulfilled(requestId: string): Promise<ActionResult> {
  if (!navigator.onLine) return { outcome: "error", message: OFFLINE_MESSAGE };
  const { error } = await createClient().rpc("catering_mark_fulfilled", { p_request_id: requestId });
  if (!error) return { outcome: "done" };
  return failure(error, error.code === "DC016" ? "This event hasn't happened yet." : "Couldn't mark it fulfilled. Try again.");
}

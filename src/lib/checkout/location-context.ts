import "server-only";

/**
 * One location's live state for checkout and the payment webhook: its row,
 * hours, upcoming closures, how busy the queue is and how full each slot is.
 * Service role, because counting other customers' orders is exactly what
 * RLS hides from a customer -- only counts leave this module.
 */
import { z } from "zod";

import type { PickupContext, PickupSettings } from "@/lib/checkout/pickup";
import { isAcceptingOrders, type Closure, type WeeklyHours } from "@/lib/locations/status";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, cafeDateKey } from "@/lib/time";

export interface LocationRecord {
  id: string;
  name: string;
  type: "cafe" | "event";
  acceptingOrders: boolean;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  prepTimeMinutes: number;
  pickupInstructions: string | null;
  addressLines: string[];
}

export interface LocationSnapshot {
  location: LocationRecord;
  hours: WeeklyHours[];
  closures: Closure[];
}

/** The location, its weekly hours and closures from today on. Null if missing or switched off. */
export async function loadLocationSnapshot(locationId: string, now: Date = new Date()): Promise<LocationSnapshot | null> {
  // The id goes into a PostgREST filter string below; only ever a UUID.
  if (!z.guid().safeParse(locationId).success) return null;
  const db = createAdminClient();
  const [location, hours, closures] = await Promise.all([
    db
      .from("locations")
      .select(
        "id, name, type, accepting_orders, paused_until, is_active, starts_at, ends_at, prep_time_minutes, pickup_instructions, address_line1, address_line2, city, state, postal_code",
      )
      .eq("id", locationId)
      .maybeSingle(),
    db.from("location_hours").select("day_of_week, opens_at, closes_at").eq("location_id", locationId),
    db
      .from("closures")
      .select("location_id, closure_date, is_closed, opens_at, closes_at, reason")
      .or(`location_id.eq.${locationId},location_id.is.null`)
      .gte("closure_date", cafeDateKey(addDays(now, -1)))
      .lte("closure_date", cafeDateKey(addDays(now, 15))),
  ]);

  for (const result of [location, hours, closures]) {
    if (result.error) throw new Error(`Checkout: could not load the location (${result.error.message})`);
  }
  const row = location.data;
  if (!row || !row.is_active) return null;

  const cityLine = [row.city, [row.state, row.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    location: {
      id: row.id,
      name: row.name,
      type: row.type,
      acceptingOrders: isAcceptingOrders(row.accepting_orders, row.paused_until, now),
      isActive: row.is_active,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      prepTimeMinutes: row.prep_time_minutes,
      pickupInstructions: row.pickup_instructions,
      addressLines: [row.address_line1, row.address_line2, cityLine].filter((l): l is string => Boolean(l)),
    },
    hours: (hours.data ?? []).map((h) => ({ dayOfWeek: h.day_of_week, opensAt: h.opens_at, closesAt: h.closes_at })),
    closures: (closures.data ?? []).map((c) => ({
      locationId: c.location_id,
      date: c.closure_date,
      isClosed: c.is_closed,
      opensAt: c.opens_at,
      closesAt: c.closes_at,
      reason: c.reason,
    })),
  };
}

/** Orders the counter is working on now: what the ASAP estimate queues behind. */
async function activeQueueCount(locationId: string): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("location_id", locationId)
    .in("status", ["placed", "accepted", "preparing"]);
  if (error) throw new Error(`Checkout: could not count the queue (${error.message})`);
  return count ?? 0;
}

/**
 * Scheduled orders per slot start from now on. Unpaid checkouts count while
 * they are fresh, so a slot is not oversold while people are paying.
 */
async function slotBookings(
  locationId: string,
  now: Date,
  pendingExpiryMinutes: number,
  excludeIdempotencyKey?: string,
): Promise<Record<string, number>> {
  const pendingSince = new Date(now.getTime() - pendingExpiryMinutes * 60_000).toISOString();
  let query = createAdminClient()
    .from("orders")
    .select("scheduled_for, status, created_at, idempotency_key")
    .eq("location_id", locationId)
    .eq("pickup_type", "scheduled")
    .gte("scheduled_for", now.toISOString())
    .in("status", ["pending_payment", "placed", "accepted", "preparing", "ready"]);
  if (excludeIdempotencyKey) query = query.neq("idempotency_key", excludeIdempotencyKey);

  const { data, error } = await query;
  if (error) throw new Error(`Checkout: could not count slot bookings (${error.message})`);

  const counts: Record<string, number> = {};
  for (const order of data ?? []) {
    if (!order.scheduled_for) continue;
    if (order.status === "pending_payment" && order.created_at < pendingSince) continue;
    const key = new Date(order.scheduled_for).toISOString();
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Everything getPickupOptions needs for this location, right now. */
export async function loadPickupContext(
  snapshot: LocationSnapshot,
  settings: { pickup: PickupSettings; pendingExpiryMinutes: number; onlineOrderingEnabled: boolean },
  now: Date,
  excludeIdempotencyKey?: string,
): Promise<PickupContext> {
  const [queue, bookings] = await Promise.all([
    activeQueueCount(snapshot.location.id),
    slotBookings(snapshot.location.id, now, settings.pendingExpiryMinutes, excludeIdempotencyKey),
  ]);
  return {
    location: snapshot.location,
    hours: snapshot.hours,
    closures: snapshot.closures,
    onlineOrderingEnabled: settings.onlineOrderingEnabled,
    now,
    settings: settings.pickup,
    activeQueueCount: queue,
    slotBookings: bookings,
  };
}

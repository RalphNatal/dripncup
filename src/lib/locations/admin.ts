import "server-only";

/** The Locations screen's reads: the cafe, its weekly hours, upcoming closures. */
import { createClient } from "@/lib/supabase/server";
import { cafeDateKey } from "@/lib/time";

export interface AdminCafe {
  id: string;
  name: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  mapUrl: string;
  latitude: string;
  longitude: string;
  pickupInstructions: string;
  prepTimeMinutes: number;
  imagePath: string | null;
  acceptingOrders: boolean;
  pausedUntil: string | null;
  pausedAt: string | null;
}

export interface HoursRange {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
}

export interface AdminClosure {
  id: string;
  locationId: string | null;
  date: string;
  isClosed: boolean;
  opensAt: string | null;
  closesAt: string | null;
  reason: string | null;
}

export async function getAdminLocations(now: Date): Promise<{ cafes: AdminCafe[]; hours: HoursRange[]; closures: AdminClosure[]; events: { id: string; name: string; startsAt: string }[] }> {
  const supabase = await createClient();
  const [locations, hours, closures] = await Promise.all([
    supabase
      .from("locations")
      .select("id, type, name, description, address_line1, address_line2, city, state, postal_code, phone, map_url, latitude, longitude, pickup_instructions, prep_time_minutes, image_url, accepting_orders, paused_until, paused_at, starts_at, ends_at, is_active")
      .order("sort_order"),
    supabase.from("location_hours").select("location_id, day_of_week, opens_at, closes_at").order("day_of_week").order("opens_at"),
    supabase.from("closures").select("id, location_id, closure_date, is_closed, opens_at, closes_at, reason").gte("closure_date", cafeDateKey(now)).order("closure_date"),
  ]);
  for (const r of [locations, hours, closures]) if (r.error) throw new Error(`Locations: ${r.error.message}`);
  const rows = locations.data ?? [];
  const cafes = rows.filter((l) => l.type === "cafe");
  return {
    cafes: cafes.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description ?? "",
      addressLine1: l.address_line1 ?? "",
      addressLine2: l.address_line2 ?? "",
      city: l.city,
      state: l.state,
      postalCode: l.postal_code ?? "",
      phone: l.phone ?? "",
      mapUrl: l.map_url ?? "",
      latitude: l.latitude === null ? "" : String(l.latitude),
      longitude: l.longitude === null ? "" : String(l.longitude),
      pickupInstructions: l.pickup_instructions ?? "",
      prepTimeMinutes: l.prep_time_minutes,
      imagePath: l.image_url,
      acceptingOrders: l.accepting_orders,
      pausedUntil: l.paused_until,
      pausedAt: l.paused_at,
    })),
    hours: (hours.data ?? [])
      .filter((h) => cafes.some((c) => c.id === h.location_id))
      .map((h) => ({ dayOfWeek: h.day_of_week, opensAt: h.opens_at.slice(0, 5), closesAt: h.closes_at.slice(0, 5) })),
    closures: (closures.data ?? []).map((c) => ({
      id: c.id,
      locationId: c.location_id,
      date: c.closure_date,
      isClosed: c.is_closed,
      opensAt: c.opens_at?.slice(0, 5) ?? null,
      closesAt: c.closes_at?.slice(0, 5) ?? null,
      reason: c.reason,
    })),
    events: rows
      .filter((l) => l.type === "event" && l.ends_at && new Date(l.ends_at) > now && l.is_active)
      .map((l) => ({ id: l.id, name: l.name, startsAt: l.starts_at! })),
  };
}

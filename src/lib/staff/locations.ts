import "server-only";

/**
 * Which counters a staff member may open on /staff, and everything the
 * dashboard needs about the one they picked.
 *
 * Read with the signed-in user's own client, so RLS has the last word: a
 * barista's roster rows are the only ones they can see, and a location they
 * are not rostered to returns no orders even if they reached it some other
 * way. Admins may open every location.
 *
 * Offered: the cafe, plus pop-ups whose window touches today (Honolulu date).
 */
import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";

import { openingHours } from "@/lib/locations/opening-hours";
import { createClient } from "@/lib/supabase/server";
import { addDays, cafeDateKey, startOfCafeDay } from "@/lib/time";

import { DEFAULT_STAFF_SETTINGS, type StaffLocationContext, type StaffSettings } from "./types";

export const STAFF_LOCATION_COOKIE = "dc_staff_location";
export const STAFF_LOCATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface StaffLocationOption {
  id: string;
  name: string;
  type: "cafe" | "event";
}

interface Viewer {
  id: string;
  role: "customer" | "staff" | "admin";
}

const LOCATION_COLUMNS =
  "id, name, type, is_active, starts_at, ends_at, sort_order, prep_time_minutes, accepting_orders, paused_until, paused_at";

type LocationRow = {
  id: string;
  name: string;
  type: "cafe" | "event";
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  prep_time_minutes: number;
  accepting_orders: boolean;
  paused_until: string | null;
  paused_at: string | null;
};

/** The cafe always; a pop-up only on the days its window touches. */
function offeredToday(row: LocationRow, now: Date): boolean {
  if (!row.is_active) return false;
  if (row.type === "cafe") return true;
  if (!row.starts_at || !row.ends_at) return false;
  const dayStart = startOfCafeDay(now);
  const dayEnd = addDays(dayStart, 1);
  return new Date(row.starts_at) < dayEnd && new Date(row.ends_at) > dayStart;
}

/** Every location row this viewer could open, before the "today" filter. */
const accessibleRows = cache(async (viewer: Viewer): Promise<LocationRow[]> => {
  const supabase = await createClient();
  if (viewer.role === "admin") {
    const { data, error } = await supabase.from("locations").select(LOCATION_COLUMNS).order("sort_order");
    if (error) throw new Error(`Staff: could not load locations (${error.message})`);
    return (data ?? []) as LocationRow[];
  }
  if (viewer.role !== "staff") return [];
  const { data, error } = await supabase
    .from("staff_locations")
    .select(`location:locations(${LOCATION_COLUMNS})`)
    .eq("profile_id", viewer.id);
  if (error) throw new Error(`Staff: could not load your roster (${error.message})`);
  return (data ?? [])
    .flatMap((row) => (row.location ? [row.location as unknown as LocationRow] : []))
    .sort((a, b) => a.sort_order - b.sort_order);
});

/** The cafe first, then today's pop-ups by start time. */
export async function getStaffLocationOptions(viewer: Viewer, now = new Date()): Promise<StaffLocationOption[]> {
  const rows = (await accessibleRows(viewer)).filter((row) => offeredToday(row, now));
  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === "cafe" ? -1 : 1;
    if (a.type === "event") return (a.starts_at ?? "").localeCompare(b.starts_at ?? "");
    return a.sort_order - b.sort_order;
  });
  return rows.map((row) => ({ id: row.id, name: row.name, type: row.type }));
}

export type ResolvedStaffLocation =
  | { kind: "ok"; locationId: string }
  | { kind: "none" }
  /** Asked for by URL, but not one this viewer may open today. */
  | { kind: "forbidden" };

/**
 * Which location to show: `?location=` if given (and allowed), else the one
 * remembered on this device, else the first offered.
 */
export async function resolveStaffLocation(
  options: readonly StaffLocationOption[],
  requested: string | undefined,
): Promise<ResolvedStaffLocation> {
  if (requested !== undefined) {
    return options.some((o) => o.id === requested) ? { kind: "ok", locationId: requested } : { kind: "forbidden" };
  }
  const remembered = (await cookies()).get(STAFF_LOCATION_COOKIE)?.value;
  const pick = options.find((o) => o.id === remembered) ?? options[0];
  return pick ? { kind: "ok", locationId: pick.id } : { kind: "none" };
}

function settingNumber(rows: { key: string; value: unknown }[], key: string, fallback: number): number {
  const value = rows.find((r) => r.key === key)?.value;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The chosen location's details, hours and closures, plus the staff settings. */
export async function loadStaffLocationContext(locationId: string, now = new Date()): Promise<StaffLocationContext | null> {
  if (!z.guid().safeParse(locationId).success) return null;
  const supabase = await createClient();
  const [location, hours, closures, settings] = await Promise.all([
    supabase.from("locations").select(LOCATION_COLUMNS).eq("id", locationId).maybeSingle(),
    supabase.from("location_hours").select("day_of_week, opens_at, closes_at").eq("location_id", locationId),
    supabase
      .from("closures")
      .select("location_id, closure_date, is_closed, opens_at, closes_at, reason")
      .or(`location_id.eq.${locationId},location_id.is.null`)
      .gte("closure_date", cafeDateKey(addDays(now, -1)))
      .lte("closure_date", cafeDateKey(addDays(now, 16))),
    supabase.from("settings").select("key, value").or("key.like.staff.%,key.eq.orders.accepting_online_orders"),
  ]);
  for (const result of [location, hours, closures, settings]) {
    if (result.error) throw new Error(`Staff: could not load the location (${result.error.message})`);
  }
  const row = location.data as LocationRow | null;
  if (!row) return null;

  const settingRows = settings.data ?? [];
  const staffSettings: StaffSettings = {
    warningMinutes: settingNumber(settingRows, "staff.ticket_warning_minutes", DEFAULT_STAFF_SETTINGS.warningMinutes),
    lateMinutes: settingNumber(settingRows, "staff.ticket_late_minutes", DEFAULT_STAFF_SETTINGS.lateMinutes),
    repeatSeconds: settingNumber(settingRows, "staff.new_order_repeat_seconds", DEFAULT_STAFF_SETTINGS.repeatSeconds),
    receiptWidthMm: settingNumber(settingRows, "staff.receipt_width_mm", DEFAULT_STAFF_SETTINGS.receiptWidthMm),
    labelWidthMm: settingNumber(settingRows, "staff.label_width_mm", DEFAULT_STAFF_SETTINGS.labelWidthMm),
    labelHeightMm: settingNumber(settingRows, "staff.label_height_mm", DEFAULT_STAFF_SETTINGS.labelHeightMm),
  };
  const globalSwitch = settingRows.find((r) => r.key === "orders.accepting_online_orders")?.value;

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    prepTimeMinutes: row.prep_time_minutes,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    acceptingOrders: row.accepting_orders,
    pausedUntil: row.paused_until,
    pausedAt: row.paused_at,
    onlineOrderingEnabled: typeof globalSwitch === "boolean" ? globalSwitch : true,
    ...openingHours(hours.data, closures.data),
    settings: staffSettings,
  };
}

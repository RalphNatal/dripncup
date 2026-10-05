import "server-only";

/**
 * Which locations a customer can order from, their live status, and which
 * one they have picked.
 *
 * Read fresh on every request (never cached across requests): the pause
 * toggle, hours and closures must be current. React's `cache` dedupes it
 * within a request, so the header and the page share one round trip.
 */
import { cookies } from "next/headers";
import { cache } from "react";

import { createPublicClient } from "@/lib/supabase/public";
import { cafeDateKey, addDays } from "@/lib/time";

import { LOCATION_COOKIE } from "./cookie";
import { openingHours } from "./opening-hours";
import {
  getLocationStatus,
  isAcceptingOrders,
  orderingUnavailableReason,
  statusDetail,
  statusLabel,
  todaysHoursText,
  type Closure,
  type LocationStatus,
  type WeeklyHours,
} from "./status";

/** Everything the UI needs about a location, as plain serialisable data. */
export interface LocationView {
  id: string;
  slug: string;
  type: "cafe" | "event";
  name: string;
  description: string | null;
  addressLines: string[];
  /** Destination for map links. */
  directionsQuery: string;
  pickupInstructions: string | null;
  prepTimeMinutes: number;
  status: {
    kind: LocationStatus["kind"];
    canOrder: boolean;
    label: string;
    detail: string | null;
    /** Why ordering is off, as a sentence. Null when the location can take orders. */
    unavailableReason: string | null;
  };
  todaysHours: { hours: string; note: string | null };
}

export interface Storefront {
  locations: LocationView[];
  /** The customer's pick, else the cafe. Null only if no location is set up. */
  selected: LocationView | null;
}

type LocationRow = {
  id: string;
  slug: string;
  type: "cafe" | "event";
  name: string;
  description: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string;
  state: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  pickup_instructions: string | null;
  prep_time_minutes: number;
  accepting_orders: boolean;
  paused_until: string | null;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
};

function settingBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toView(
  row: LocationRow,
  hours: WeeklyHours[],
  closures: Closure[],
  now: Date,
  onlineOrderingEnabled: boolean,
  defaultPickupInstructions: string | null,
): LocationView {
  const location = {
    id: row.id,
    type: row.type,
    acceptingOrders: isAcceptingOrders(row.accepting_orders, row.paused_until, now),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
  const status = getLocationStatus({ location, hours, closures, now, onlineOrderingEnabled });

  const cityLine = [row.city, [row.state, row.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const addressLines = [row.address_line1, row.address_line2, cityLine].filter((l): l is string => Boolean(l));
  const directionsQuery =
    row.address_line1 !== null
      ? [row.address_line1, cityLine].join(", ")
      : row.latitude !== null && row.longitude !== null
        ? `${row.latitude},${row.longitude}`
        : row.name;

  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    name: row.name,
    description: row.description,
    addressLines,
    directionsQuery,
    pickupInstructions: row.pickup_instructions ?? defaultPickupInstructions,
    prepTimeMinutes: row.prep_time_minutes,
    status: {
      kind: status.kind,
      canOrder: status.canOrder,
      label: statusLabel(status, now),
      detail: statusDetail(status, now),
      unavailableReason: orderingUnavailableReason(status, row.name, now),
    },
    todaysHours: todaysHoursText({ location, hours, closures, now }),
  };
}

export const getStorefront = cache(async (): Promise<Storefront> => {
  // Read the cookie first: it marks the route as per-request before any query
  // runs, so nothing below is ever fetched at build time.
  const chosenId = (await cookies()).get(LOCATION_COOKIE)?.value;
  const now = new Date();
  const db = createPublicClient({ live: true });

  // Closures from today to the edge of the "next opening" lookahead.
  const from = cafeDateKey(now);
  const to = cafeDateKey(addDays(now, 15));

  const [locations, hours, closures, settings] = await Promise.all([
    db
      .from("locations")
      .select(
        "id, slug, type, name, description, address_line1, address_line2, city, state, postal_code, latitude, longitude, pickup_instructions, prep_time_minutes, accepting_orders, paused_until, starts_at, ends_at, sort_order",
      )
      .eq("is_active", true)
      .order("sort_order"),
    db.from("location_hours").select("location_id, day_of_week, opens_at, closes_at"),
    db
      .from("closures")
      .select("location_id, closure_date, is_closed, opens_at, closes_at, reason")
      .gte("closure_date", from)
      .lte("closure_date", to),
    db.from("settings").select("key, value").in("key", ["orders.accepting_online_orders", "store.pickup_instructions"]),
  ]);

  for (const result of [locations, hours, closures, settings]) {
    if (result.error) throw new Error(`Locations: could not load (${result.error.message})`);
  }

  const setting = (key: string) => settings.data?.find((s) => s.key === key)?.value;
  const onlineOrderingEnabled = settingBoolean(setting("orders.accepting_online_orders"), true);
  const pickupSetting = setting("store.pickup_instructions");
  const defaultPickupInstructions = typeof pickupSetting === "string" ? pickupSetting : null;

  // The cafe, plus any pop-up that is running now or still to come.
  const rows = ((locations.data ?? []) as LocationRow[]).filter(
    (row) => row.type === "cafe" || (row.ends_at !== null && new Date(row.ends_at) > now),
  );
  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type === "cafe" ? -1 : 1;
    if (a.type === "event") return (a.starts_at ?? "").localeCompare(b.starts_at ?? "");
    return a.sort_order - b.sort_order;
  });

  const views = rows.map((row) => {
    const opening = openingHours(
      (hours.data ?? []).filter((h) => h.location_id === row.id),
      closures.data,
    );
    return toView(row, opening.hours, opening.closures, now, onlineOrderingEnabled, defaultPickupInstructions);
  });

  const selected =
    views.find((v) => v.id === chosenId) ?? views.find((v) => v.type === "cafe") ?? views[0] ?? null;

  return { locations: views, selected };
});

"use server";

/**
 * Locations: the cafe's details, weekly hours, closures and holiday hours,
 * and the pause toggle. Every reader of hours reads them live through
 * openingHours() (storefront, checkout, the payment webhook, the staff
 * screen), so a change applies at once -- and local test mode
 * (TEST_STORE_ALWAYS_OPEN) still overrides them in development.
 */
import { revalidatePath } from "next/cache";

import { currentAdmin, isUuid, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

import { hoursProblem } from "./hours-rules";

function refresh() {
  revalidatePath("/admin/locations");
  revalidatePath("/admin");
  revalidatePath("/", "layout");
}

export interface CafeInput {
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
  prepTimeMinutes: string;
  imagePath: string | null;
}

export async function saveCafeAction(input: CafeInput): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!input || !isUuid(input.id)) return { ok: false, message: "Location not found." };
  const errors: Record<string, string> = {};
  if (input.name.trim().length < 2) errors.name = "Give the cafe a name.";
  if (input.postalCode.trim() && !/^\d{5}$/.test(input.postalCode.trim())) errors.postalCode = "A 5-digit ZIP code.";
  if (input.mapUrl.trim() && !/^https:\/\/\S+$/.test(input.mapUrl.trim())) errors.mapUrl = "Paste a full https:// link from Google Maps or Apple Maps.";
  if (!/^\d{1,3}$/.test(input.prepTimeMinutes.trim()) || Number(input.prepTimeMinutes) > 240) errors.prepTimeMinutes = "Minutes from 0 to 240.";
  for (const [key, min, max] of [["latitude", -90, 90], ["longitude", -180, 180]] as const) {
    const v = input[key].trim();
    if (v && (!/^-?\d{1,3}(\.\d{1,6})?$/.test(v) || Number(v) < min || Number(v) > max)) errors[key] = `A number from ${min} to ${max}.`;
  }
  if ((input.latitude.trim() === "") !== (input.longitude.trim() === "")) errors.longitude = "Enter both, or neither.";
  if (Object.keys(errors).length) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_cafe", {
    p: {
      id: input.id,
      name: input.name,
      description: input.description,
      address_line1: input.addressLine1,
      address_line2: input.addressLine2,
      city: input.city,
      state: input.state,
      postal_code: input.postalCode,
      phone: input.phone,
      map_url: input.mapUrl,
      latitude: input.latitude,
      longitude: input.longitude,
      pickup_instructions: input.pickupInstructions,
      prep_time_minutes: Number(input.prepTimeMinutes),
      image_url: input.imagePath ?? "",
    },
  });
  if (error) return rpcFailure(error, "Couldn't save the cafe.");
  refresh();
  return { ok: true, message: "Cafe details saved." };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveHoursAction(locationId: unknown, ranges: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(locationId) || !Array.isArray(ranges)) return { ok: false, message: "Location not found." };
  const clean = ranges
    .filter((r): r is { dayOfWeek: number; opensAt: string; closesAt: string } => !!r && typeof r === "object")
    .map((r) => ({ dayOfWeek: Number(r.dayOfWeek), opensAt: String(r.opensAt), closesAt: String(r.closesAt) }));
  const errors = hoursProblem(clean);
  if (Object.keys(errors).length) return { ok: false, message: "Please check the highlighted days.", fieldErrors: errors };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_location_hours", {
    p_location_id: locationId,
    p_hours: clean.map((r) => ({ day_of_week: r.dayOfWeek, opens_at: r.opensAt, closes_at: r.closesAt })),
  });
  if (error) return rpcFailure(error, "Couldn't save the hours.");
  refresh();
  return { ok: true, message: "Weekly hours saved. They apply now." };
}

export interface ClosureInput {
  id: string | null;
  locationId: string | null;
  date: string;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
  reason: string;
}

export async function saveClosureAction(input: ClosureInput): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.date ?? "")) errors.date = "Pick a date.";
  if (!input.isClosed) {
    if (!TIME.test(input.opensAt)) errors.opensAt = "Pick an opening time.";
    if (!TIME.test(input.closesAt) && input.closesAt !== "24:00") errors.closesAt = "Pick a closing time.";
    else if (!errors.opensAt && input.closesAt !== "24:00" && input.closesAt <= input.opensAt) errors.closesAt = "Close after it opens.";
  }
  if (input.reason.length > 200) errors.reason = "Up to 200 characters.";
  if (Object.keys(errors).length) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: errors };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_closure", {
    p: {
      id: isUuid(input.id) ? input.id : null,
      location_id: isUuid(input.locationId) ? input.locationId : null,
      closure_date: input.date,
      is_closed: input.isClosed,
      opens_at: input.isClosed ? "" : input.opensAt,
      closes_at: input.isClosed ? "" : input.closesAt,
      reason: input.reason,
    },
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "There's already a closure for that date.", fieldErrors: { date: "That date already has one: edit it instead." } };
    return rpcFailure(error, "Couldn't save the closure.");
  }
  refresh();
  return { ok: true, message: input.isClosed ? "Closure saved." : "Holiday hours saved." };
}

export async function deleteClosureAction(id: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(id)) return { ok: false, message: "Closure not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_closure", { p_id: id });
  if (error) return rpcFailure(error, "Couldn't remove the closure.");
  refresh();
  return { ok: true, message: "Removed." };
}

/** Pause or resume online orders (the staff toggle's function). minutes = null pauses until resumed. */
export async function setPauseAction(locationId: unknown, paused: unknown, minutes: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(locationId) || typeof paused !== "boolean") return { ok: false, message: "Location not found." };
  if (minutes !== null && (typeof minutes !== "number" || ![15, 30, 60, 120].includes(minutes))) return { ok: false, message: "Choose how long." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_location_accepting_orders", {
    target_location_id: locationId,
    accepting: !paused,
    resume_at: paused && minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : undefined,
  });
  if (error) return rpcFailure(error, "Couldn't change that.");
  refresh();
  return { ok: true, message: paused ? "Online orders paused." : "Online orders are back on." };
}

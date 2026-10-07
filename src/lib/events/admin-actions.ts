"use server";

/**
 * Admin event actions. Each re-checks the caller is an admin; the database
 * functions (admin_save_event, admin_set_event_published,
 * admin_duplicate_event) check again and run as the admin, so who made each
 * change is stamped on the row.
 *
 * Event menus live in the cached catalogue, so every change expires the
 * `menu` tag at once (updateTag): customers see a published event, or one
 * taken down, on their next page load.
 */
import { revalidatePath, updateTag } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { issuesByPath } from "@/lib/forms";
import { MENU_CACHE_TAG } from "@/lib/menu/catalog";
import { createClient } from "@/lib/supabase/server";

import { eventFormSchema, eventWindow, type EventFormInput } from "./schemas";
import { eventSlug } from "./window";

async function isAdmin() {
  return (await getCurrentProfile())?.role === "admin";
}

function refresh(id?: string) {
  updateTag(MENU_CACHE_TAG);
  revalidatePath("/admin/events");
  if (id) revalidatePath(`/admin/events/${id}`);
  revalidatePath("/events");
  revalidatePath("/");
}

export type SaveEventResult = { ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function saveEventAction(input: EventFormInput): Promise<SaveEventResult> {
  if (!(await isAdmin())) return { ok: false, message: "Only an admin can manage events." };
  const parsed = eventFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: issuesByPath(parsed.error) };
  const form = parsed.data;
  const window = eventWindow(form.date, form.startTime, form.endTime)!;

  // A new event that has already ended is a typo, not an event.
  if (!form.id && window.endsAt.getTime() <= (await appNow()).getTime()) {
    return { ok: false, message: "That event has already ended.", fieldErrors: { date: "Pick a date and time in the future." } };
  }

  const slug = form.slug || eventSlug(form.name, form.date);
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_save_event", {
    p_event: {
      id: form.id,
      name: form.name,
      slug,
      description: form.description,
      address_line1: form.addressLine1,
      address_line2: form.addressLine2,
      city: form.city || "Honolulu",
      state: "HI",
      postal_code: form.postalCode,
      latitude: form.latitude,
      longitude: form.longitude,
      map_url: form.mapUrl,
      starts_at: window.startsAt.toISOString(),
      ends_at: window.endsAt.toISOString(),
      prep_time_minutes: form.prepTimeMinutes,
      image_url: form.imagePath ?? "",
      pickup_instructions: form.pickupInstructions,
    },
    p_menu: form.menu,
    p_staff: form.staff,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That web address is taken.", fieldErrors: { slug: "Another event already uses this web address." } };
    if (error.code === "DC020") return { ok: false, message: "A published event needs at least one menu item.", fieldErrors: { menu: "Add at least one item, or unpublish the event first." } };
    if (error.code === "22023") return { ok: false, message: error.message };
    throw new Error(`Could not save the event: ${error.message}`);
  }
  refresh(id);
  return { ok: true, id };
}

export async function setEventPublishedAction(eventId: unknown, published: unknown): Promise<{ ok: boolean; message: string }> {
  if (!(await isAdmin())) return { ok: false, message: "Only an admin can publish events." };
  if (typeof eventId !== "string" || typeof published !== "boolean") return { ok: false, message: "Event not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_event_published", { p_event_id: eventId, p_published: published });
  if (error) {
    return { ok: false, message: error.code === "DC020" ? "Add at least one menu item before publishing." : "Couldn't change that. Please try again." };
  }
  refresh(eventId);
  return { ok: true, message: published ? "Published. Customers can see it now." : "Unpublished. Customers can no longer see it." };
}

export async function duplicateEventAction(eventId: unknown, date: unknown): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  if (!(await isAdmin())) return { ok: false, message: "Only an admin can manage events." };
  if (typeof eventId !== "string" || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Pick a date." };
  }
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_duplicate_event", { p_event_id: eventId, p_date: date });
  if (error || !id) return { ok: false, message: "Couldn't duplicate the event. Please try again." };
  refresh(id);
  return { ok: true, id };
}

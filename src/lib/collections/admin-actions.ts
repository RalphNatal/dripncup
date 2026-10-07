"use server";

/**
 * Saving a seasonal collection. Re-checks the caller is an admin;
 * admin_save_collection checks again, runs as the admin (who is stamped on
 * the row) and saves the collection, its products and any limited-time
 * windows in one transaction. Collections and product windows live in the
 * cached catalogue, so the `menu` tag is expired at once.
 */
import { revalidatePath, updateTag } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/dal";
import { slugify } from "@/lib/events/window";
import { issuesByPath } from "@/lib/forms";
import { MENU_CACHE_TAG } from "@/lib/menu/catalog";
import { createClient } from "@/lib/supabase/server";
import { cafeInstant } from "@/lib/time";

import { normalizeHexColor } from "./contrast";
import { collectionFormSchema, type CollectionFormInput } from "./schemas";

export type SaveCollectionResult = { ok: true; id: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function saveCollectionAction(input: CollectionFormInput): Promise<SaveCollectionResult> {
  if ((await getCurrentProfile())?.role !== "admin") return { ok: false, message: "Only an admin can manage collections." };
  const parsed = collectionFormSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: issuesByPath(parsed.error) };
  const form = parsed.data;

  const slug = form.slug || slugify(form.name).slice(0, 80) || "collection";
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_save_collection", {
    p_collection: {
      id: form.id,
      name: form.name,
      slug,
      description: form.description,
      banner_image_url: form.bannerPath ?? "",
      accent_color: form.accentColor ? normalizeHexColor(form.accentColor) : "",
      starts_at: cafeInstant(form.startDate, form.startTime)!.toISOString(),
      ends_at: cafeInstant(form.endDate, form.endTime)!.toISOString(),
      is_active: form.isActive,
    },
    p_products: form.products.map((p) => ({ product_id: p.productId, limited: p.limited })),
  });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That web address is taken.", fieldErrors: { slug: "Another collection already uses this web address." } };
    if (error.code === "23514") return { ok: false, message: "Please check the colour and the web address." };
    if (error.code === "22023") return { ok: false, message: error.message };
    throw new Error(`Could not save the collection: ${error.message}`);
  }

  updateTag(MENU_CACHE_TAG);
  revalidatePath("/admin/collections");
  revalidatePath(`/admin/collections/${id}`);
  revalidatePath(`/collections/${slug}`);
  revalidatePath("/menu");
  revalidatePath("/");
  return { ok: true, id };
}

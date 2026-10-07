"use server";

/**
 * Menu editor actions. Each checks the caller is an admin; the admin_*
 * database functions check again, validate, and run as the admin (audit
 * log). The catalogue is cached for customers, so every change expires the
 * `menu` tag at once: customers see it on their next page, carts are
 * re-priced on their next check (with a notice), and past orders keep
 * their snapshots.
 */
import { revalidatePath, updateTag } from "next/cache";

import { currentAdmin, isUuid, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { slugify } from "@/lib/events/window";
import { MENU_CACHE_TAG } from "@/lib/menu/catalog";
import { createClient } from "@/lib/supabase/server";

import { groupDraftToRpc, productDraftToRpc, validateGroupDraft, validateProductDraft, type GroupDraft, type ProductDraft } from "./rules";
import { listAdminGroups } from "./queries";

function refresh(...paths: string[]) {
  updateTag(MENU_CACHE_TAG);
  revalidatePath("/admin/menu", "layout");
  for (const path of paths) revalidatePath(path);
  revalidatePath("/menu", "layout");
  revalidatePath("/");
}

const CHECK_FIELDS = "Please check the highlighted fields.";

// ---- Categories ------------------------------------------------------------

export async function saveCategoryAction(input: {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
}): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  const name = String(input?.name ?? "").trim();
  if (!name) return { ok: false, message: "Give the category a name.", fieldErrors: { name: "Give the category a name." } };
  const slug = String(input.slug ?? "").trim() || slugify(name).slice(0, 80);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_save_category", {
    p: { id: isUuid(input.id) ? input.id : null, name, slug, description: String(input.description ?? ""), is_active: input.isActive !== false },
  });
  if (error) return rpcFailure(error, "Couldn't save the category.");
  refresh("/admin/menu/categories");
  return { ok: true, id: data, message: input.id ? "Category saved." : "Category added." };
}

export async function reorderCategoriesAction(ids: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!Array.isArray(ids) || !ids.every(isUuid)) return { ok: false, message: "Couldn't read the new order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_categories", { p_ids: ids });
  if (error) return rpcFailure(error, "Couldn't save the new order.");
  refresh("/admin/menu/categories");
  return { ok: true };
}

export async function deleteCategoryAction(id: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(id)) return { ok: false, message: "Category not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_delete_category", { p_id: id });
  if (error) return rpcFailure(error, "Couldn't delete the category.");
  refresh("/admin/menu/categories");
  return { ok: true, message: "Category deleted." };
}

// ---- Products --------------------------------------------------------------

export async function saveProductAction(draft: ProductDraft): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.sizes) || !Array.isArray(draft.groups)) {
    return { ok: false, message: CHECK_FIELDS };
  }
  if (draft.id !== null && !isUuid(draft.id)) return { ok: false, message: "Product not found." };
  // The same rules as the form, against the groups as they are now.
  const errors = validateProductDraft(draft, await listAdminGroups());
  if (Object.keys(errors).length) return { ok: false, message: CHECK_FIELDS, fieldErrors: errors };

  const supabase = await createClient();
  const rpc = productDraftToRpc(draft);
  const { data: id, error } = await supabase.rpc("admin_save_product", rpc);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That web address is taken.", fieldErrors: { slug: "Another product already uses this web address." } };
    return rpcFailure(error, "Couldn't save the product.");
  }
  refresh(`/admin/menu/products/${id}`);
  return { ok: true, id, message: draft.id ? "Saved. New carts and orders use these prices; past orders keep theirs." : "Product created." };
}

type ProductRpc = "admin_archive_product" | "admin_restore_product" | "admin_delete_product";

/** One of the product lifecycle calls; null when it worked. */
async function productCall(id: unknown, call: (supabase: Awaited<ReturnType<typeof createClient>>, id: string) => PromiseLike<{ error: import("@supabase/supabase-js").PostgrestError | null }>) {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(id)) return { ok: false as const, message: "Product not found." };
  const { error } = await call(await createClient(), id);
  if (error) return rpcFailure(error, "Couldn't change the product.");
  refresh(`/admin/menu/products/${id}`);
  return null;
}

const simple = (fn: ProductRpc) => (supabase: Awaited<ReturnType<typeof createClient>>, id: string) => supabase.rpc(fn, { p_id: id });

export async function setProductActiveAction(id: unknown, active: unknown): Promise<ActionResult> {
  if (typeof active !== "boolean") return { ok: false, message: "Choose on or off." };
  return (
    (await productCall(id, (supabase, productId) => supabase.rpc("admin_set_product_active", { p_id: productId, p_active: active }))) ?? {
      ok: true,
      message: active ? "Switched on. Customers can order it." : "Switched off. Hidden from customers.",
    }
  );
}

export async function archiveProductAction(id: unknown): Promise<ActionResult> {
  return (await productCall(id, simple("admin_archive_product"))) ?? { ok: true, message: "Archived. It's off the menu; past orders keep it." };
}

export async function restoreProductAction(id: unknown): Promise<ActionResult> {
  return (await productCall(id, simple("admin_restore_product"))) ?? { ok: true, message: "Restored. Switch it on when it's ready." };
}

export async function deleteProductAction(id: unknown): Promise<ActionResult> {
  return (await productCall(id, simple("admin_delete_product"))) ?? { ok: true, message: "Deleted." };
}

export async function reorderProductsAction(ids: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!Array.isArray(ids) || !ids.every(isUuid)) return { ok: false, message: "Couldn't read the new order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_products", { p_ids: ids });
  if (error) return rpcFailure(error, "Couldn't save the new order.");
  refresh();
  return { ok: true };
}

// ---- Modifier groups -------------------------------------------------------

export async function saveGroupAction(draft: GroupDraft): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.options)) return { ok: false, message: CHECK_FIELDS };
  if (draft.id !== null && !isUuid(draft.id)) return { ok: false, message: "Group not found." };
  const errors = validateGroupDraft(draft);
  if (Object.keys(errors).length) return { ok: false, message: CHECK_FIELDS, fieldErrors: errors };
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_save_modifier_group", groupDraftToRpc(draft));
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That short name is taken.", fieldErrors: { slug: "Another group already uses this short name." } };
    return rpcFailure(error, "Couldn't save the group.");
  }
  refresh(`/admin/menu/modifiers/${id}`);
  return { ok: true, id, message: draft.id ? "Saved. Every product with this group uses it now." : "Group created." };
}

async function groupCall(fn: "admin_archive_modifier_group" | "admin_restore_modifier_group" | "admin_delete_modifier_group", id: unknown, done: string): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(id)) return { ok: false, message: "Group not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_id: id });
  if (error) return rpcFailure(error, "Couldn't change the group.");
  refresh(`/admin/menu/modifiers/${id}`);
  return { ok: true, message: done };
}

export async function archiveGroupAction(id: unknown) {
  return groupCall("admin_archive_modifier_group", id, "Archived.");
}

export async function restoreGroupAction(id: unknown) {
  return groupCall("admin_restore_modifier_group", id, "Restored. Switch it on when it's ready.");
}

export async function deleteGroupAction(id: unknown) {
  return groupCall("admin_delete_modifier_group", id, "Deleted.");
}

// ---- Sold out ----------------------------------------------------------------

/** Clears a sold-out flag from the overview (set_sold_out, as at the counter). */
export async function clearSoldOutAction(locationId: unknown, kind: unknown, itemId: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(locationId) || !isUuid(itemId) || (kind !== "product" && kind !== "option")) return { ok: false, message: "Not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sold_out", {
    p_location_id: locationId,
    p_product_id: kind === "product" ? itemId : undefined,
    p_modifier_option_id: kind === "option" ? itemId : undefined,
    p_sold_out: false,
  });
  if (error) return rpcFailure(error, "Couldn't change that.");
  refresh("/admin/menu/sold-out");
  return { ok: true, message: "Back on the menu." };
}

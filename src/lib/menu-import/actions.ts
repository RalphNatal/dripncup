"use server";

/**
 * The menu import, from the admin's upload:
 *
 *   preview   read and check the file, compare with the menu, change nothing
 *   apply     the same again from the same file (never a plan the browser
 *             sends back), then admin_import_menu(): one transaction, all or
 *             nothing, one audit entry
 *
 * The file is parsed on the server only and nothing in it is executed
 * (./file.ts, ./xlsx.ts).
 */
import { revalidatePath, updateTag } from "next/cache";

import { currentAdmin, NOT_ADMIN, rpcFailure } from "@/lib/admin/guard";
import { MENU_CACHE_TAG } from "@/lib/menu/catalog";
import { createClient } from "@/lib/supabase/server";

import { readMenuFile } from "./file";
import { parseMenuRows, toImportRpcPlan, type ImportRowError, type KnownGroup } from "./parse";
import { previewImport, type ExistingProduct, type ImportPreview } from "./preview";

export type ImportCheck =
  | { ok: true; fileName: string; rowCount: number; errors: ImportRowError[]; preview: ImportPreview | null }
  | { ok: false; message: string };

export type ImportApply =
  | { ok: true; message: string; summary: Record<string, number | boolean> }
  | { ok: false; message: string; errors?: ImportRowError[] };

async function loadMenu() {
  const supabase = await createClient();
  const [groups, categories, products] = await Promise.all([
    supabase.from("modifier_groups").select("id, slug, name, archived_at, modifier_options(id, name, archived_at)"),
    supabase.from("categories").select("id, slug"),
    supabase
      .from("products")
      .select(
        "slug, name, description, category_id, base_price_cents, is_active, archived_at, is_catering_eligible, allergens, dietary_tags, product_sizes(name, price_cents, is_default, archived_at, sort_order), product_modifier_groups(modifier_group_id, visible_when_option_id, sort_order)",
      ),
  ]);
  for (const result of [groups, categories, products]) if (result.error) throw new Error(`Import: ${result.error.message}`);

  const known: KnownGroup[] = (groups.data ?? [])
    .filter((g) => !g.archived_at)
    .map((g) => ({ id: g.id, slug: g.slug, name: g.name, options: (g.modifier_options ?? []).filter((o) => !o.archived_at).map((o) => ({ id: o.id, name: o.name })) }));
  const slugOfGroup = new Map((groups.data ?? []).map((g) => [g.id, g.slug]));
  const slugOfCategory = new Map((categories.data ?? []).map((c) => [c.id, c.slug]));
  const existing: ExistingProduct[] = (products.data ?? []).map((p) => ({
    slug: p.slug,
    name: p.name,
    description: p.description,
    categorySlug: p.category_id ? (slugOfCategory.get(p.category_id) ?? null) : null,
    basePriceCents: p.base_price_cents,
    isActive: p.is_active,
    archived: Boolean(p.archived_at),
    cateringEligible: p.is_catering_eligible,
    allergens: p.allergens,
    dietaryTags: p.dietary_tags,
    sizes: [...(p.product_sizes ?? [])]
      .filter((s) => !s.archived_at)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({ name: s.name, priceCents: s.price_cents, isDefault: s.is_default })),
    groups: [...(p.product_modifier_groups ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ slug: slugOfGroup.get(l.modifier_group_id) ?? "", whenOptionId: l.visible_when_option_id })),
  }));
  return { known, categories: categories.data ?? [], existing };
}

async function readUpload(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, message: "Choose a .csv or .xlsx file." };
  const read = readMenuFile(file.name, new Uint8Array(await file.arrayBuffer()));
  if (!read.ok) return { ok: false as const, message: read.message };
  return { ok: true as const, name: file.name.slice(0, 120), rows: read.rows };
}

export async function previewImportAction(formData: FormData): Promise<ImportCheck> {
  if (!(await currentAdmin())) return NOT_ADMIN as { ok: false; message: string };
  const upload = await readUpload(formData);
  if (!upload.ok) return upload;
  const menu = await loadMenu();
  const parsed = parseMenuRows(upload.rows, menu.known);
  return {
    ok: true,
    fileName: upload.name,
    rowCount: parsed.rowCount,
    errors: parsed.errors,
    preview: parsed.errors.length ? null : previewImport(parsed.plan, { categories: menu.categories, products: menu.existing }, { archiveMissing: formData.get("archiveMissing") === "on" }),
  };
}

export async function applyImportAction(formData: FormData): Promise<ImportApply> {
  if (!(await currentAdmin())) return NOT_ADMIN as { ok: false; message: string };
  if (formData.get("confirm") !== "yes") return { ok: false, message: "Preview the import, then confirm it." };
  const upload = await readUpload(formData);
  if (!upload.ok) return upload;
  const menu = await loadMenu();
  const parsed = parseMenuRows(upload.rows, menu.known);
  if (parsed.errors.length) return { ok: false, message: "The file has errors, so nothing was changed.", errors: parsed.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_import_menu", {
    p_plan: toImportRpcPlan(parsed.plan) as never,
    p_archive_missing: formData.get("archiveMissing") === "on",
    p_source: upload.name,
  });
  if (error) return rpcFailure(error, "The import failed, so nothing was changed.");

  updateTag(MENU_CACHE_TAG);
  revalidatePath("/admin/menu", "layout");
  revalidatePath("/menu", "layout");
  const summary = (data ?? {}) as Record<string, number | boolean>;
  return {
    ok: true,
    summary,
    message: `Imported: ${summary.products_created ?? 0} new, ${summary.products_updated ?? 0} updated${summary.products_archived ? `, ${summary.products_archived} archived` : ""}.`,
  };
}

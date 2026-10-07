"use server";

/**
 * Rewards admin: tiers (create, edit, reorder, on/off) and manual point
 * adjustments through admin_adjust_points (reason required; the admin is
 * recorded on the ledger row and in the audit log).
 */
import { revalidatePath } from "next/cache";

import { currentAdmin, isUuid, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

export interface TierForm {
  id: string | null;
  name: string;
  description: string;
  pointsCost: string;
  type: "free_item" | "free_modifier" | "amount_off";
  value: string;
  coversModifiers: boolean;
  productIds: string[];
  categoryIds: string[];
  modifierGroupIds: string[];
  eligibilityLabel: string;
  isActive: boolean;
}

function refresh() {
  revalidatePath("/admin/rewards", "layout");
  revalidatePath("/rewards");
  revalidatePath("/");
}

export async function saveTierAction(form: TierForm): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!form || typeof form !== "object" || (form.id !== null && !isUuid(form.id))) return { ok: false, message: "Reward not found." };
  const errors: Record<string, string> = {};
  if (form.name.trim().length < 2 || form.name.trim().length > 60) errors.name = "2 to 60 characters.";
  if (!/^\d{1,6}$/.test(form.pointsCost.trim()) || Number(form.pointsCost) < 1 || Number(form.pointsCost) > 100_000) errors.pointsCost = "Whole points from 1 to 100,000.";
  const value = form.value.trim() ? (/^\d{1,4}(\.\d{1,2})?$/.test(form.value.trim()) ? Math.round(Number(form.value) * 100) : null) : undefined;
  if (value === null || value === 0) errors.value = "An amount like 7.50.";
  if (form.type === "amount_off" && value === undefined) errors.value = "How much off the order?";
  if (form.eligibilityLabel.length > 60) errors.eligibilityLabel = "Up to 60 characters.";
  const ids = [...form.productIds, ...form.categoryIds, ...form.modifierGroupIds];
  if (!ids.every(isUuid)) return { ok: false, message: "Check the eligible items." };
  if (Object.keys(errors).length) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: errors };

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_save_reward", {
    p: {
      id: form.id,
      name: form.name.trim(),
      description: form.description.trim(),
      points_cost: Number(form.pointsCost),
      type: form.type,
      value_cents: value ?? null,
      covers_modifiers: form.coversModifiers,
      applicable_product_ids: form.type === "free_modifier" ? [] : form.productIds,
      applicable_category_ids: form.type === "free_modifier" ? [] : form.categoryIds,
      applicable_modifier_group_ids: form.type === "free_modifier" ? form.modifierGroupIds : [],
      eligibility_label: form.eligibilityLabel.trim(),
      is_active: form.isActive,
    },
  });
  if (error) return rpcFailure(error, "Couldn't save the reward.");
  refresh();
  return { ok: true, id, message: form.id ? "Reward saved." : "Reward created." };
}

export async function reorderTiersAction(ids: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!Array.isArray(ids) || !ids.every(isUuid)) return { ok: false, message: "Couldn't read the new order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_reorder_rewards", { p_ids: ids });
  if (error) return rpcFailure(error, "Couldn't save the new order.");
  refresh();
  return { ok: true };
}

export async function adjustPointsAction(userId: unknown, points: unknown, reason: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(userId)) return { ok: false, message: "Member not found." };
  const amount = typeof points === "string" ? Number(points.trim()) : Number(points);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100_000) {
    return { ok: false, message: "Enter whole points, like 50 or -20.", fieldErrors: { points: "Whole points, like 50 or -20 (not 0)." } };
  }
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 3) return { ok: false, message: "Give a reason.", fieldErrors: { reason: "A reason is required (3 characters or more)." } };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_adjust_points", { p_user_id: userId, p_points: amount, p_reason: why.slice(0, 200) });
  if (error) return rpcFailure(error, "Couldn't adjust the points.");
  revalidatePath(`/admin/rewards/members/${userId}`);
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/rewards");
  return { ok: true, message: `${amount > 0 ? "Added" : "Took off"} ${Math.abs(amount)} point${Math.abs(amount) === 1 ? "" : "s"}.` };
}

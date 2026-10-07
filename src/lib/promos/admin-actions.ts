"use server";

/** Saving a promo code. Once redeemed, its code and discount are locked by the database (DC040). */
import { revalidatePath } from "next/cache";

import { currentAdmin, isUuid, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

import { promoFormToRpc, validatePromo, type PromoForm } from "./admin";

export async function savePromoAction(form: PromoForm): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!form || typeof form !== "object" || (form.id !== null && !isUuid(form.id))) return { ok: false, message: "Promo not found." };
  const errors = validatePromo(form);
  if (Object.keys(errors).length) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: errors };
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("admin_save_promo", { p: promoFormToRpc(form) });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "That code is taken.", fieldErrors: { code: "Another promo already uses this code (codes ignore case)." } };
    if (error.code === "DC040") return { ok: false, message: error.message, fieldErrors: { code: "Locked: this code has been used." } };
    return rpcFailure(error, "Couldn't save the promo.");
  }
  revalidatePath("/admin/promos");
  revalidatePath(`/admin/promos/${id}`);
  return { ok: true, id, message: form.id ? "Promo saved." : "Promo created." };
}

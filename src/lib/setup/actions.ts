"use server";

/** Marking setup checklist items confirmed (or not). */
import { revalidatePath } from "next/cache";

import { currentAdmin, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

export async function setConfirmedAction(kind: unknown, key: unknown, confirmed: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if ((kind !== "setting" && kind !== "content" && kind !== "task") || typeof key !== "string" || typeof confirmed !== "boolean") {
    return { ok: false, message: "Unknown checklist item." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_confirmed", { p_kind: kind, p_key: key, p_confirmed: confirmed });
  if (error) return rpcFailure(error, "Couldn't update the checklist.");
  revalidatePath("/admin/setup");
  revalidatePath("/admin");
  return { ok: true, message: confirmed ? "Marked confirmed." : "Marked as still to confirm." };
}

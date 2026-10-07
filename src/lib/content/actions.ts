"use server";

/** Saving site content (About, contact, social links, logo, policies). */
import { revalidatePath } from "next/cache";

import { currentAdmin, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

import { contentItem, contentProblem, formatPhoneInput } from "./registry";

export async function saveContentAction(key: unknown, value: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  const item = typeof key === "string" ? contentItem(key) : null;
  if (!item || typeof value !== "string") return { ok: false, message: "Unknown content." };
  const text = item.kind === "phone" ? formatPhoneInput(value) : value.trim();
  const problem = contentProblem(item, text);
  if (problem) return { ok: false, message: problem, fieldErrors: { [item.key]: problem } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_save_content", { p_key: item.key, p_value: text });
  if (error) return rpcFailure(error, "Couldn't save that.");
  revalidatePath("/admin/content");
  revalidatePath("/admin/setup");
  revalidatePath("/", "layout");
  return { ok: true, message: `${item.label} saved.` };
}

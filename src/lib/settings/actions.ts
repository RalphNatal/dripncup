"use server";

/**
 * Saving one setting: the registry's friendly checks, the rules that span
 * two settings, then admin_update_setting(), which checks the type and
 * limits again and runs as the admin (so the audit log records who changed
 * it, from what, to what).
 *
 * Every reader of settings reads fresh (checkout, the storefront, the staff
 * screen, catering, rewards), so a change applies to the next request.
 */
import { revalidatePath } from "next/cache";

import { currentAdmin, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { createClient } from "@/lib/supabase/server";

import { crossCheck, formatSettingValue, parseSettingInput, settingDefinition } from "./registry";
import { getStoredSettings } from "./queries";

export async function updateSettingAction(key: unknown, raw: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  const def = typeof key === "string" ? settingDefinition(key) : null;
  if (!def || (typeof raw !== "string" && typeof raw !== "boolean")) return { ok: false, message: "Unknown setting." };

  const parsed = parseSettingInput(def, raw);
  if (!parsed.ok) return { ok: false, message: parsed.message, fieldErrors: { [def.key]: parsed.message } };

  const stored = await getStoredSettings();
  const values = new Map([...stored].map(([k, s]) => [k, s.value]));
  if (JSON.stringify(values.get(def.key)) === JSON.stringify(parsed.value)) {
    return { ok: true, message: "No change." };
  }
  values.set(def.key, parsed.value);
  const conflict = crossCheck(def.key, values);
  if (conflict) return { ok: false, message: conflict, fieldErrors: { [def.key]: conflict } };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_setting", { p_key: def.key, p_value: parsed.value as never });
  if (error) return rpcFailure(error, "Couldn't save that setting.");

  revalidatePath("/", "layout");
  return { ok: true, message: `${def.label}: ${formatSettingValue(def, parsed.value)}.` };
}

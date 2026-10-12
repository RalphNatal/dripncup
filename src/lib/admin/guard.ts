import "server-only";

/**
 * Shared by every admin Server Action: who is calling, and turning a
 * database refusal into a sentence for the admin.
 *
 * Server Actions can be reached without the page that rendered them, so
 * each one asks `currentAdmin()` itself; the admin_* database functions
 * check the role again (42501) and validate again.
 */
import type { PostgrestError } from "@supabase/supabase-js";

import { getCurrentProfile } from "@/lib/auth/dal";
import { logError } from "@/lib/log";

export async function currentAdmin() {
  const profile = await getCurrentProfile();
  return profile?.role === "admin" ? profile : null;
}

export type ActionResult =
  | { ok: true; message?: string; id?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export const NOT_ADMIN: ActionResult = { ok: false, message: "Only an admin can do that." };

/**
 * The database's own messages are written for the admin (22023 and our DC
 * codes); anything else gets `fallback`, and is logged.
 */
export function rpcFailure(error: PostgrestError, fallback: string): { ok: false; message: string } {
  if (error.code === "42501") return { ok: false, message: "Only an admin can do that." };
  if (error.code === "23505") return { ok: false, message: "That name or web address is already taken." };
  if (error.code === "22023" || error.code?.startsWith("DC") || error.code === "P0002") {
    return { ok: false, message: error.message.endsWith(".") ? error.message : `${error.message}.` };
  }
  logError("admin.action_failed", error, { shown: fallback });
  return { ok: false, message: fallback };
}

/** A note typed into a dialog: trimmed, at least 3 characters. */
export function noteOrNull(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  return trimmed.length >= 3 && trimmed.length <= 1000 ? trimmed : null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

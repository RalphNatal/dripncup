"use server";

/**
 * Users: role changes (with the admin's password, checked by the Phase 2
 * re-auth module), staff location rosters, and a password reset email.
 * The database enforces the rules too (admin_set_role): never your own role
 * (DC050), never the last admin (DC051), demoting staff clears rosters.
 * Admins never see or set passwords, and cannot delete accounts here.
 */
import { revalidatePath } from "next/cache";

import { currentAdmin, isUuid, NOT_ADMIN, rpcFailure, type ActionResult } from "@/lib/admin/guard";
import { verifyPassword } from "@/lib/auth/reauthenticate";
import { clientEnv } from "@/lib/env";
import { hit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const ROLES = ["customer", "staff", "admin"] as const;

/** At most five password checks per admin per ten minutes, on top of Supabase Auth's own limit. */
const REAUTH_LIMIT = { scope: "admin:reauth", max: 5, windowSeconds: 600 } as const;

export async function changeRoleAction(userId: unknown, role: unknown, password: unknown): Promise<ActionResult> {
  const admin = await currentAdmin();
  if (!admin) return NOT_ADMIN;
  if (!isUuid(userId) || typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) return { ok: false, message: "User not found." };
  if (userId === admin.id) return { ok: false, message: "You can't change your own role. Ask another admin." };
  if (typeof password !== "string" || !password) return { ok: false, message: "Enter your password.", fieldErrors: { password: "Enter your password to confirm." } };
  if (!admin.email) return { ok: false, message: "Your account has no email to check the password against." };
  if (!(await hit(REAUTH_LIMIT, admin.id))) return { ok: false, message: "Too many password attempts. Wait a few minutes." };

  const check = await verifyPassword(admin.id, admin.email, password);
  if (check !== "ok") {
    const message = check === "invalid" ? "That password isn't right." : check === "rate_limited" ? "Too many attempts. Wait a few minutes." : "Couldn't check your password. Try again.";
    return { ok: false, message, fieldErrors: { password: message } };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_role", { p_user_id: userId, p_role: role as (typeof ROLES)[number] });
  if (error) return rpcFailure(error, "Couldn't change the role.");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  return { ok: true, message: role === "customer" ? "Now a customer. Any staff locations were removed." : `Now ${role === "admin" ? "an admin" : "staff"}.` };
}

export async function setStaffLocationsAction(userId: unknown, locationIds: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(userId) || !Array.isArray(locationIds) || !locationIds.every(isUuid)) return { ok: false, message: "User not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_staff_locations", { p_user_id: userId, p_location_ids: locationIds });
  if (error) return rpcFailure(error, "Couldn't save the locations.");
  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, message: "Locations saved." };
}

/** The customer chooses their own new password from the email; the admin never sees it. */
export async function sendPasswordResetAction(userId: unknown): Promise<ActionResult> {
  if (!(await currentAdmin())) return NOT_ADMIN;
  if (!isUuid(userId)) return { ok: false, message: "User not found." };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("email, deleted_at").eq("id", userId).maybeSingle();
  if (!profile?.email || profile.deleted_at) return { ok: false, message: "This account has no email." };
  const redirect = new URL("/auth/callback", clientEnv.NEXT_PUBLIC_SITE_URL);
  redirect.searchParams.set("next", "/account/password");
  const { error } = await supabase.auth.resetPasswordForEmail(profile.email, { redirectTo: redirect.toString() });
  if (error) {
    return { ok: false, message: error.code?.includes("rate_limit") ? "Too many emails just now. Try again in a few minutes." : "Couldn't send the email." };
  }
  return { ok: true, message: `Password reset email sent to ${profile.email}.` };
}

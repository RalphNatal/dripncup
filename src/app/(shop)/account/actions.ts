"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { LAST_ADMIN_SQLSTATE, isLastAdmin, removeAuthUser } from "@/lib/auth/account-deletion";
import { settleOrdersBeforeAccountDeletion } from "@/lib/orders/account-deletion";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth/dal";
import { GENERIC_ERROR, authErrorMessage, echoValues, type FormState } from "@/lib/auth/form-state";
import { verifyPassword } from "@/lib/auth/reauthenticate";
import { deleteAccountSchema, firstFieldErrors, profileSchema } from "@/lib/auth/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Saves the customer's own profile. RLS limits the row to theirs and column
 * privileges limit what can change, so role, points and member code are out
 * of reach even if this action were called with extra fields.
 */
export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { status: "error", message: "Your session has ended. Sign in again to save changes." };
  }

  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: firstFieldErrors(parsed.error), values: echoValues(formData) };
  }

  const { fullName, firstName, phone, marketingOptIn, smsOptIn, orderReadyEmail } = parsed.data;

  if (smsOptIn && !phone) {
    return {
      status: "error",
      fieldErrors: { smsOptIn: "Add a phone number to get texts." },
      values: echoValues(formData),
    };
  }

  // Keep keys this form does not edit (push arrives with notifications).
  const existingPrefs =
    profile.notification_prefs && typeof profile.notification_prefs === "object" && !Array.isArray(profile.notification_prefs)
      ? profile.notification_prefs
      : {};

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      first_name: firstName ?? fullName.split(/\s+/)[0] ?? null,
      phone,
      marketing_opt_in: marketingOptIn,
      sms_opt_in: smsOptIn,
      notification_prefs: { ...existingPrefs, order_ready_email: orderReadyEmail },
    })
    .eq("id", profile.id);

  if (error) {
    return { status: "error", message: GENERIC_ERROR, values: echoValues(formData) };
  }

  revalidatePath("/account");
  return { status: "success", message: "Saved.", values: echoValues(formData) };
}

/**
 * "Delete my account", after the customer has re-entered their password and
 * typed DELETE.
 *
 * The data work is one database transaction (delete_account_data), so the
 * account is either closed completely or not at all. Only then is the login
 * itself removed. What is cancelled, kept and scrubbed is documented on that
 * function and in ARCHITECTURE.md.
 */
export async function deleteAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  const [user, profile] = await Promise.all([getCurrentUser(), getCurrentProfile()]);
  if (!user?.email || !profile) {
    return { status: "error", message: "Your session has ended. Sign in again to continue." };
  }

  const parsed = deleteAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: firstFieldErrors(parsed.error), values: echoValues(formData) };
  }

  const check = await verifyPassword(user.id, user.email, parsed.data.password);
  if (check === "invalid") {
    return {
      status: "error",
      fieldErrors: { password: "That password isn't right. Your account has not been deleted." },
      values: echoValues(formData),
    };
  }
  if (check !== "ok") {
    const message = check === "rate_limited" ? authErrorMessage("over_request_rate_limit") : GENERIC_ERROR;
    return { status: "error", message, values: echoValues(formData) };
  }

  const lastAdminMessage = "You're the only admin. Make someone else an admin before deleting your account.";
  // Checked before any refund: refusing after refunding would be the worst of
  // both. The database repeats the check under a lock.
  if (profile.role === "admin" && (await isLastAdmin(profile.id))) {
    return { status: "error", message: lastAdminMessage };
  }

  // Money first: refund paid orders still in progress, cancel payments not
  // yet made. A failed refund is recorded for an admin and does not block.
  await settleOrdersBeforeAccountDeletion(user.id);

  // Service role: this has to reach rows RLS hides from the customer (their
  // orders' payments, the staff roster) and write columns they cannot.
  const { error } = await createAdminClient().rpc("delete_account_data", { target_user_id: user.id });
  if (error) {
    if (error.code === LAST_ADMIN_SQLSTATE) {
      return { status: "error", message: lastAdminMessage };
    }
    console.error(`Account ${user.id}: delete_account_data failed`, error);
    return { status: "error", message: GENERIC_ERROR, values: echoValues(formData) };
  }

  // The account is closed from here on. Clear this browser's session first,
  // so the cookies go even if removing the login below were to fail.
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });

  // Also ends every other session. On failure the tombstone keeps them out and
  // their next sign-in attempt retries this (see signIn).
  await removeAuthUser(user.id);

  revalidatePath("/", "layout");
  redirect("/?account=deleted");
}

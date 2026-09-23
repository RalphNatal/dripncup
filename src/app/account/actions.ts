"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/dal";
import { GENERIC_ERROR, echoValues, type FormState } from "@/lib/auth/form-state";
import { firstFieldErrors, profileSchema } from "@/lib/auth/schemas";
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

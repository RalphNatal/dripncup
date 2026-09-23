/**
 * The shape every auth/account Server Action returns to `useActionState`,
 * plus the mapping from Supabase auth errors to copy a customer can act on.
 *
 * Lives outside the "use server" module because that file may only export
 * async functions.
 */
import type { FieldErrors } from "@/lib/auth/schemas";

export type FormState = {
  status: "idle" | "error" | "success";
  /** Form-level message, shown in an alert above the submit button. */
  message?: string;
  fieldErrors?: FieldErrors;
  /**
   * What the visitor typed, echoed back so React's post-action form reset
   * does not wipe it. Never includes passwords.
   */
  values?: Record<string, string>;
};

export const IDLE: FormState = { status: "idle" };

export const GENERIC_ERROR = "Something went wrong on our end. Please try again.";

/** Maps a Supabase `AuthError.code` to customer-facing copy. */
export function authErrorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_credentials":
      return "That email and password don't match. Check them and try again.";
    case "email_not_confirmed":
      return "Confirm your email first — the link is in your inbox.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead.";
    case "weak_password":
      return "Choose a stronger password — longer, or less common.";
    case "same_password":
      return "Your new password must be different from the current one.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Wait a few minutes, then try again.";
    case "signup_disabled":
      return "New sign-ups are paused right now.";
    default:
      return GENERIC_ERROR;
  }
}

/** Plain-string view of FormData, minus anything that looks like a password. */
export function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (key.startsWith("$ACTION") || key.toLowerCase().includes("password")) continue;
    values[key] = value;
  }
  return values;
}

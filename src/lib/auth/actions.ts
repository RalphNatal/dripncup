"use server";

/**
 * Sign-in, sign-up, sign-out and password Server Actions.
 *
 * All of them run with the anon-key server client, acting as the visitor, so
 * Supabase Auth applies its own rate limits and the session cookie is written
 * on the response. `redirect()` throws, so it is always called outside any
 * try/catch.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/dal";
import { authErrorMessage, echoValues, type FormState } from "@/lib/auth/form-state";
import { safeNextPath } from "@/lib/auth/redirect";
import {
  firstFieldErrors,
  forgotPasswordSchema,
  newPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@/lib/auth/schemas";
import { clientEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Where an emailed link lands before continuing to `next`. */
function callbackUrl(next: string) {
  const url = new URL("/auth/callback", clientEnv.NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("next", next);
  return url.toString();
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: firstFieldErrors(parsed.error), values: echoValues(formData) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { status: "error", message: authErrorMessage(error.code), values: echoValues(formData) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("deleted_at")
    .eq("id", data.user.id)
    .single();

  if (!profile || profile.deleted_at) {
    await supabase.auth.signOut({ scope: "local" });
    return { status: "error", message: "This account has been closed." };
  }

  revalidatePath("/", "layout");
  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: firstFieldErrors(parsed.error), values: echoValues(formData) };
  }

  const { fullName, email, password, phone, marketingOptIn } = parsed.data;
  const next = safeNextPath(formData.get("next"));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by public.handle_new_user() to fill in the profile row.
      data: { full_name: fullName, phone, marketing_opt_in: marketingOptIn },
      emailRedirectTo: callbackUrl(next),
    },
  });

  if (error) {
    return { status: "error", message: authErrorMessage(error.code), values: echoValues(formData) };
  }

  // With email confirmation on there is no session yet. Supabase also answers
  // this way for an address that is already registered, so the reply cannot
  // be used to discover who has an account.
  if (!data.session) {
    return {
      status: "success",
      message: `Check ${email} for a link to confirm your account.`,
    };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  // This device only; signing out a phone should not end a laptop session.
  await supabase.auth.signOut({ scope: "local" });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: firstFieldErrors(parsed.error), values: echoValues(formData) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: callbackUrl("/account/password"),
  });

  // Rate limiting is the only failure worth surfacing. Anything else gets the
  // same reply as success, so this form cannot confirm who has an account.
  if (error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return { status: "error", message: authErrorMessage(error.code), values: echoValues(formData) };
  }

  return {
    status: "success",
    message: `If ${parsed.data.email} has an account, a reset link is on its way.`,
  };
}

export async function updatePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) {
    return { status: "error", message: "Your reset link has expired. Request a new one." };
  }

  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", fieldErrors: firstFieldErrors(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { status: "error", message: authErrorMessage(error.code) };
  }

  return { status: "success", message: "Password updated." };
}

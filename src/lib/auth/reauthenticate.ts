import "server-only";

/**
 * "Prove it's still you" checks for sensitive actions such as deleting the
 * account.
 *
 * v1 only has email + password accounts, so the one check is the password.
 * When Google / Apple sign-in arrive (see ARCHITECTURE.md, Post-launch), an
 * account without a password needs a different proof -- a fresh OAuth round
 * trip or an emailed one-time code. That becomes another function here;
 * callers only need to know whether the check passed.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { clientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

export type ReauthResult = "ok" | "invalid" | "rate_limited" | "error";

/**
 * Checks `password` against the account without touching the visitor's
 * session cookies.
 *
 * A throwaway client signs in with no persistence, so the check cannot
 * replace or extend the current session. The session it mints is revoked
 * straight away. Supabase Auth's own rate limit on password sign-ins applies.
 */
export async function verifyPassword(
  userId: string,
  email: string,
  password: string,
): Promise<ReauthResult> {
  const verifier = createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );

  const { data, error } = await verifier.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.code === "invalid_credentials") return "invalid";
    if (error.code === "over_request_rate_limit") return "rate_limited";
    return "error";
  }

  // Only a password check: do not leave a live refresh token lying around.
  await verifier.auth.signOut({ scope: "local" });

  // Belt and braces -- the email came from this user's session, but make sure
  // the password unlocked the same account.
  return data.user?.id === userId ? "ok" : "invalid";
}

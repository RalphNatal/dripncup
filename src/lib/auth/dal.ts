import "server-only";

/**
 * Data access layer for "who is this, and may they be here?".
 *
 * The proxy already redirects signed-out and wrong-role visitors, but it is an
 * optimistic gate: Server Actions and nested segments can be reached without
 * passing through the page that rendered them. Every protected page and every
 * mutating action calls one of these as well.
 *
 * `cache` dedupes the auth round trip within a single request, so a layout,
 * a page and a leaf component can all ask without three `getUser()` calls.
 */
import { redirect } from "next/navigation";
import { cache } from "react";

import type { UserRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user, verified against the auth server.
 *
 * Always prefer this to `getSession()` on the server: `getSession()` trusts the
 * cookie as-is, which a client could have tampered with.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** The signed-in user's profile row, including their role. Null when signed out. */
export const getCurrentProfile = cache(async () => {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  // A soft-deleted account keeps its row for order history but may not sign in.
  if (!data || data.deleted_at) return null;
  return data;
});

function signInPath(returnTo: string) {
  return `/sign-in?next=${encodeURIComponent(returnTo)}`;
}

/** The current profile, or a redirect to sign-in that comes back to `returnTo`. */
export async function requireProfile(returnTo: string) {
  const profile = await getCurrentProfile();
  if (!profile) redirect(signInPath(returnTo));
  return profile;
}

/** Like `requireProfile`, and also sends the wrong role home. */
export async function requireRole(roles: readonly UserRole[], returnTo: string) {
  const profile = await requireProfile(returnTo);
  if (!roles.includes(profile.role)) redirect("/");
  return profile;
}

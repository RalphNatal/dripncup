import "server-only";

/**
 * Helpers shared by the "delete my account" action and sign-in.
 *
 * The flow is two steps (see supabase/migrations/..._account_deletion.sql):
 *   1. delete_account_data() scrubs and tombstones everything in one
 *      transaction -- from this point the account is closed.
 *   2. The auth user is deleted through the admin API, which cascades the
 *      profile row away.
 * If step 2 ever fails, the tombstone keeps the account locked out, and the
 * next sign-in attempt finishes the job (see `signIn`).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** SQLSTATE raised by delete_account_data() for the last remaining admin. */
export const LAST_ADMIN_SQLSTATE = "DC001";

/**
 * True when this admin is the only one left. Advisory: the database repeats
 * the check under a lock, so this only decides what the page shows.
 * Admins can read every profile through RLS, so no service role is needed.
 */
export async function isLastAdmin(adminId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .is("deleted_at", null)
    .neq("id", adminId);

  // On error, say yes: the page then hides a form the database would refuse.
  if (error) return true;
  return (count ?? 0) === 0;
}

/** Step 2: remove the auth user. Returns false (and logs) if that failed. */
export async function removeAuthUser(userId: string): Promise<boolean> {
  const { error } = await createAdminClient().auth.admin.deleteUser(userId);
  if (error) {
    console.error(`Account ${userId}: data removed but the auth user could not be deleted`, error);
    return false;
  }
  return true;
}

/**
 * Service-role database access for arranging and checking e2e test state.
 * Test code only -- the app itself never reaches this file.
 */
import { createClient, type PostgrestSingleResponse, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";

import type { Database } from "../../src/types/database";

config({ path: ".env.local" });
config({ path: ".env" });

let client: SupabaseClient<Database> | undefined;

export function db(): SupabaseClient<Database> {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("e2e tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error(`Refusing to run e2e tests against a non-local database (${url}).`);
  }

  client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/**
 * Throws with context instead of handing back a silent null. Typed with
 * Supabase's own response type for the reason given in supabase/seed/seed.ts.
 */
export function must<T>(result: PostgrestSingleResponse<T>, label: string): NonNullable<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data === null || result.data === undefined) throw new Error(`${label}: no data`);
  return result.data;
}

/** Same password as the seeded accounts (README). */
export const TEST_PASSWORD = "DrincupTest123!";

export const SEEDED = {
  admin: "admin@drincup.test",
  customer: "customer@drincup.test",
  cafeSlug: "kapiolani",
  eventSlug: "kakaako-market-popup",
} as const;

export async function locationIdBySlug(slug: string): Promise<string> {
  const row = must(await db().from("locations").select("id").eq("slug", slug).single(), `location ${slug}`);
  return row.id;
}

/** A throwaway customer with a confirmed email. */
export async function createCustomer(label: string) {
  const email = `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@drincup.test`;
  const { data, error } = await db().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Kai E2E" },
  });
  if (error || !data.user) throw new Error(`create ${email}: ${error?.message ?? "no user"}`);

  must(
    await db()
      .from("profiles")
      .update({ phone: "+18085550142", first_name: "Kai" })
      .eq("id", data.user.id)
      .select()
      .single(),
    "set profile details",
  );

  return { id: data.user.id, email, password: TEST_PASSWORD };
}

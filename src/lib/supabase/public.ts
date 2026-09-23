import "server-only";

/**
 * Anon-key client with no cookies: it sees exactly what a signed-out guest
 * sees under RLS (active menu rows, locations, public settings).
 *
 * Because its answers never depend on who is asking, it is the one client
 * that is safe inside `unstable_cache` -- a cookie-bound client there could
 * cache one customer's view and serve it to the next.
 *
 * `live: true` is for data that must be current on every request (pause
 * toggle, hours, sold-out flags). It sends every request with
 * `cache: "no-store"`, so Next.js never keeps a copy -- not even the one it
 * would otherwise take while prerendering during `next build`.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { clientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: "no-store" });

export function createPublicClient({ live = false }: { live?: boolean } = {}) {
  return createSupabaseClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(live ? { global: { fetch: noStoreFetch } } : {}),
  });
}

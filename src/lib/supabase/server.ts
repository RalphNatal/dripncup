import "server-only";

/**
 * Server-side Supabase client for Server Components, Server Actions and Route
 * Handlers.
 *
 * Still the anon key, so RLS applies -- this client acts *as the signed-in
 * user*. For the handful of operations that must bypass RLS (Stripe webhooks,
 * seeding, admin reports), use `createAdminClient()` instead and be explicit
 * about it.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { clientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The middleware refreshes
            // the session on every request, so it is safe to ignore here.
          }
        },
      },
    },
  );
}

// Who is signed in, and what they may do: see `@/lib/auth/dal`.

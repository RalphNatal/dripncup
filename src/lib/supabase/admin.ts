import "server-only";

/**
 * Service-role Supabase client. **Bypasses Row Level Security entirely.**
 *
 * Only for operations that genuinely cannot run as the user:
 *   - the Stripe webhook, which has no session at all
 *   - crediting loyalty points when an order is marked picked up
 *   - validating a promo code without making the promos table readable
 *   - admin reports that aggregate across every customer
 *
 * The `server-only` import above turns any accidental client import into a
 * build error rather than a leaked key.
 */
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { clientEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env";
import type { Database } from "@/types/database";

export function createAdminClient() {
  return createSupabaseClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // No session to persist or refresh: this client is never a user.
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

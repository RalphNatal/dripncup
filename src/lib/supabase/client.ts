"use client";

/**
 * Browser Supabase client.
 *
 * Uses the anon key, so every query it makes is subject to Row Level Security.
 * Safe to use from client components.
 */
import { createBrowserClient } from "@supabase/ssr";

import { clientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * `createBrowserClient` already memoises per-page, but keeping one reference
 * avoids re-subscribing Realtime channels on every render.
 */
let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

export function createClient() {
  if (!client) {
    client = createBrowserClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }
  return client;
}

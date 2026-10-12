/**
 * Public environment variables (NEXT_PUBLIC_*), validated once at module load.
 *
 * Safe to import anywhere, including client components. The server's secrets
 * live in `env.server.ts`, which is server-only: importing it from a client
 * component fails the build rather than leaking a key.
 *
 * Checked by hand rather than with Zod on purpose: this module is in every
 * page's browser bundle (the Supabase browser client reads it), and Zod would
 * add ~90 KB of JavaScript to each of them.
 *
 * Values are trimmed: a stray space after a pasted key is invisible in an
 * editor and would otherwise fail signature checks.
 */

import { parseClientEnv, type ClientEnv } from "./env-parse";

export type { ClientEnv };

// Each NEXT_PUBLIC_ variable is named in full so Next inlines it into the
// browser bundle (it replaces literal `process.env.NEXT_PUBLIC_X` reads).
const parsedClient = parseClientEnv({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
});

if ("problems" in parsedClient) {
  throw new Error(
    `Invalid public environment variables. Copy .env.example to .env.local and fill these in:\n${parsedClient.problems
      .map((p) => `  - ${p}`)
      .join("\n")}`,
  );
}

export const clientEnv: ClientEnv = parsedClient.env;

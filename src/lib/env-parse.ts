/**
 * Checks the public environment variables (NEXT_PUBLIC_*) by hand. Pure, so
 * it is unit-tested; env.ts runs it once at load. No Zod: this is in every
 * page's browser bundle.
 */

export interface ClientEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  NEXT_PUBLIC_SITE_URL: string;
  /** Safe to expose; Stripe.js needs it in the browser. Checkout requires it. */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  /** Web Push (VAPID) public key; `npm run push:keys` writes it. Unset = push off. */
  NEXT_PUBLIC_VAPID_PUBLIC_KEY?: string;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Trimmed, or undefined when unset or blank. */
function read(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The parsed values, or the list of problems. Exported for tests. */
export function parseClientEnv(raw: Record<keyof ClientEnv, string | undefined>): { env: ClientEnv } | { problems: string[] } {
  const problems: string[] = [];
  const supabaseUrl = read(raw.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = read(raw.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const siteUrl = read(raw.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000";

  if (!supabaseUrl || !isUrl(supabaseUrl)) {
    problems.push("NEXT_PUBLIC_SUPABASE_URL: NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. http://127.0.0.1:54321");
  }
  if (!anonKey) problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY: required");
  if (!isUrl(siteUrl)) problems.push("NEXT_PUBLIC_SITE_URL: must be a full URL, e.g. https://order.example.com");

  if (problems.length) return { problems };
  return {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl!,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey!,
      NEXT_PUBLIC_SITE_URL: siteUrl,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: read(raw.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY),
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: read(raw.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    },
  };
}

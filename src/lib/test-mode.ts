/**
 * Local test mode: `TEST_STORE_ALWAYS_OPEN=true` in `.env.local` treats every
 * location as open around the clock, so the ordering flows can be tested
 * when it is night in Honolulu.
 *
 * The flag is honoured only when BOTH hold:
 *   - this is not a production build (`NODE_ENV !== "production"`), and
 *   - `NEXT_PUBLIC_SUPABASE_URL` points at this machine or the private LAN.
 * Anything else ignores it and logs a warning, so setting the variable on
 * Vercel by mistake does nothing: Vercel builds are production builds, and
 * they talk to a hosted Supabase project.
 *
 * Only the opening hours change (see `openingHours()` in
 * `@/lib/locations/opening-hours`). The pause toggle, sold-out flags and
 * pop-up event windows behave exactly as they do for real.
 *
 * Server-side only in practice: the variable has no NEXT_PUBLIC_ prefix, so
 * in a browser bundle it is always undefined and the mode reads as off.
 */

export interface StoreAlwaysOpenEnv {
  TEST_STORE_ALWAYS_OPEN?: string;
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}

export type StoreAlwaysOpenDecision =
  | { active: true }
  /** `warning` is set when the flag was asked for but refused. */
  | { active: false; warning: string | null };

/** 127.0.0.1, localhost, ::1, or a private IPv4 address (phone testing over Wi-Fi). */
export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host === "[::1]" || host === "::1") return true;

  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)) return false;
  const [a, b] = octets.map(Number);
  return (
    a === 127 || // loopback
    a === 10 || // 10.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  );
}

/** Pure: whether the flag applies under these environment variables, and why not. */
export function resolveStoreAlwaysOpen(env: StoreAlwaysOpenEnv): StoreAlwaysOpenDecision {
  if (env.TEST_STORE_ALWAYS_OPEN?.trim().toLowerCase() !== "true") return { active: false, warning: null };

  if (env.NODE_ENV === "production") {
    return {
      active: false,
      warning: "TEST_STORE_ALWAYS_OPEN is set but ignored: this is a production build. Store hours apply.",
    };
  }
  if (!isLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
    return {
      active: false,
      warning:
        "TEST_STORE_ALWAYS_OPEN is set but ignored: NEXT_PUBLIC_SUPABASE_URL is not a local address. Store hours apply.",
    };
  }
  return { active: true };
}

let decided: boolean | null = null;

/**
 * Whether local test mode is on for this server process. Decided once; a
 * refused flag is reported with one warning, not one per request.
 */
export function storeAlwaysOpen(): boolean {
  if (decided !== null) return decided;
  const decision = resolveStoreAlwaysOpen({
    TEST_STORE_ALWAYS_OPEN: process.env.TEST_STORE_ALWAYS_OPEN,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (!decision.active && decision.warning && typeof window === "undefined") console.warn(decision.warning);
  decided = decision.active;
  return decided;
}

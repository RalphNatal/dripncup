import "server-only";

/**
 * Web Push settings. Push is on when both VAPID keys are set
 * (`npm run push:keys` writes them to .env.local); otherwise the app simply
 * doesn't offer it, and anything queued is skipped.
 */
import { clientEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { testClockAllowed } from "@/lib/test-clock";

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** Who push services contact about our messages: `mailto:` or `https:`. */
  subject: string;
}

/** Used when VAPID_SUBJECT is unset. NEEDS_CONFIRMATION: the cafe's real contact before launch. */
export const FALLBACK_VAPID_SUBJECT = "mailto:notifications@drincup.test";

export function pushConfig(): PushConfig | null {
  const publicKey = clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const { VAPID_PRIVATE_KEY, VAPID_SUBJECT } = serverEnv();
  if (!publicKey || !VAPID_PRIVATE_KEY) return null;
  const subject = VAPID_SUBJECT && /^(mailto:|https:\/\/)/.test(VAPID_SUBJECT) ? VAPID_SUBJECT : FALLBACK_VAPID_SUBJECT;
  return { publicKey, privateKey: VAPID_PRIVATE_KEY, subject };
}

/**
 * The e2e suite's stand-in push service (a local HTTP server), allowed only
 * on the Playwright test server against a local database: the same guard
 * as the e2e clock (src/lib/test-clock.ts). Empty everywhere else.
 */
export function testPushOrigins(): string[] {
  const origin = process.env.E2E_PUSH_ORIGIN?.trim();
  if (!origin || !testClockAllowed({ E2E_RUN_ID: process.env.E2E_RUN_ID, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL })) {
    return [];
  }
  try {
    return [new URL(origin).origin];
  } catch {
    return [];
  }
}

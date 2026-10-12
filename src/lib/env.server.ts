import "server-only";

/**
 * Server secrets, validated on first use.
 *
 * `serverEnv()` is a function, not a constant, so a missing optional secret
 * only fails the code that needs it (through stripeEnv(), cronSecret() and
 * friends, which say what to set). This module is server-only: importing it
 * from a client component is a build error, never a leaked key. Public
 * values are in `env.ts`.
 */
import { z } from "zod";

const trimmed = () => z.string().trim();

const serverSchema = z.object({
  /**
   * Bypasses RLS. Server-only, never in a client component, never in
   * NEXT_PUBLIC_*.
   */
  SUPABASE_SERVICE_ROLE_KEY: trimmed().pipe(z.string().min(1)),

  // Optional here so the rest of the app runs without them; the code that
  // needs them asks through stripeEnv() / cronSecret(), which fail clearly.
  STRIPE_SECRET_KEY: trimmed().optional(),
  STRIPE_WEBHOOK_SECRET: trimmed().optional(),
  /** Vercel Cron sends it as `Authorization: Bearer <secret>`. */
  CRON_SECRET: trimmed().optional(),
  /** Set → emails go through Resend. Unset → the local Mailpit (development). */
  RESEND_API_KEY: trimmed().optional(),
  /** "Drincup Cafe <orders@your-domain>"; the domain must be verified in Resend. */
  EMAIL_FROM: trimmed().optional(),
  /** Mailpit's web/API address; the local Supabase stack serves it on 54324. */
  MAILPIT_URL: trimmed().pipe(z.string().url()).default("http://127.0.0.1:54324"),
  /** Web Push: the VAPID private key matching NEXT_PUBLIC_VAPID_PUBLIC_KEY (`npm run push:keys`). */
  VAPID_PRIVATE_KEY: trimmed().optional(),
  /** Web Push: who push services contact about our pushes, `mailto:` or `https:`. */
  VAPID_SUBJECT: trimmed().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

let cachedServerEnv: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() was called in the browser. Server secrets must never reach the client bundle.");
  }

  if (cachedServerEnv) return cachedServerEnv;

  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    MAILPIT_URL: process.env.MAILPIT_URL,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  });

  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${formatIssues(parsed.error)}`);
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

/** The Stripe secrets, or a clear error naming what is missing. */
export function stripeEnv(): { secretKey: string; webhookSecret: string } {
  const env = serverEnv();
  const missing = [
    !env.STRIPE_SECRET_KEY && "STRIPE_SECRET_KEY",
    !env.STRIPE_WEBHOOK_SECRET && "STRIPE_WEBHOOK_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Stripe is not configured: set ${missing.join(" and ")} in .env.local (see README, Stripe).`);
  }
  return { secretKey: env.STRIPE_SECRET_KEY!, webhookSecret: env.STRIPE_WEBHOOK_SECRET! };
}

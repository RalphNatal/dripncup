/**
 * Environment variables, validated once at module load.
 *
 * Split deliberately in two:
 *   - `clientEnv` holds only NEXT_PUBLIC_* values and is safe to import
 *     anywhere.
 *   - `serverEnv()` is a function, not a constant, and throws if it is ever
 *     reached from a browser bundle. Importing it from a client component is a
 *     build-time mistake we want to fail loudly rather than leak a key.
 *
 * Values are trimmed: a stray space after a pasted key is invisible in an
 * editor and would otherwise fail signature checks.
 */
import { z } from "zod";

const trimmed = () => z.string().trim();

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: trimmed().pipe(
    z.string().url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. http://127.0.0.1:54321" }),
  ),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: trimmed().pipe(z.string().min(1)),
  NEXT_PUBLIC_SITE_URL: trimmed().pipe(z.string().url()).default("http://localhost:3000"),
  /** Safe to expose; Stripe.js needs it in the browser. Checkout requires it. */
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: trimmed().optional(),
});

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
});

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

const parsedClient = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
});

if (!parsedClient.success) {
  throw new Error(
    `Invalid public environment variables. Copy .env.example to .env.local and fill these in:\n${formatIssues(
      parsedClient.error,
    )}`,
  );
}

export const clientEnv = parsedClient.data;

let cachedServerEnv: z.infer<typeof serverSchema> | null = null;

export function serverEnv(): z.infer<typeof serverSchema> {
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

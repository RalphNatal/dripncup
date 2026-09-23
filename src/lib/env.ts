/**
 * Environment variables, validated once at module load.
 *
 * Split deliberately in two:
 *   - `clientEnv` holds only NEXT_PUBLIC_* values and is safe to import
 *     anywhere.
 *   - `serverEnv()` is a function, not a constant, and throws if it is ever
 *     reached from a browser bundle. Importing it from a client component is a
 *     build-time mistake we want to fail loudly rather than leak a key.
 */
import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url({
    message: "NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. http://127.0.0.1:54321",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

const serverSchema = z.object({
  /**
   * Bypasses RLS. Server-only, never in a client component, never in
   * NEXT_PUBLIC_*.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Payments and email arrive in later phases, so they stay optional until the
  // code that needs them exists.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
});

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
}

const parsedClient = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
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
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  });

  if (!parsed.success) {
    throw new Error(`Invalid server environment variables:\n${formatIssues(parsed.error)}`);
  }

  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

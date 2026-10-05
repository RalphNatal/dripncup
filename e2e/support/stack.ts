/**
 * The e2e suite's own Supabase stack.
 *
 * `npm run test:e2e` (scripts/e2e.mjs) starts a second local stack from
 * .e2e-stack/ (project `drincup-cafe-e2e`, ports 553xx), resets and seeds it,
 * and writes its URL and keys to .e2e-stack/.env.e2e. The suite reads them
 * from there, so it never reaches the dev database in .env.local -- and
 * refuses to run if they ever point at it.
 */
import { existsSync, readFileSync } from "node:fs";

import { parse } from "dotenv";

export const E2E_STACK_ENV_FILE = ".e2e-stack/.env.e2e";

export interface E2eStackEnv {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAILPIT_URL: string;
}

function readEnv(path: string): Record<string, string> {
  return existsSync(path) ? parse(readFileSync(path)) : {};
}

/** The dev database the suite must never touch (.env.local). */
function devSupabaseUrl(): string | undefined {
  return readEnv(".env.local").NEXT_PUBLIC_SUPABASE_URL ?? readEnv(".env").NEXT_PUBLIC_SUPABASE_URL;
}

export function e2eStackEnv(): E2eStackEnv {
  const env = readEnv(E2E_STACK_ENV_FILE);
  const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MAILPIT_URL"] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(
      `The e2e database stack is not set up (${E2E_STACK_ENV_FILE} ${existsSync(E2E_STACK_ENV_FILE) ? `lacks ${missing.join(", ")}` : "is missing"}). ` +
        "Run the suite with `npm run test:e2e`, which starts, resets and seeds it.",
    );
  }
  assertNotDevDatabase(env.NEXT_PUBLIC_SUPABASE_URL);
  return env as unknown as E2eStackEnv;
}

/** Throws unless `url` is the local e2e stack (never the dev database, never a hosted one). */
export function assertNotDevDatabase(url: string) {
  const { hostname } = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname)) {
    throw new Error(`Refusing to run e2e tests against a non-local database (${url}).`);
  }
  const dev = devSupabaseUrl();
  // By port: 127.0.0.1 and localhost are the same database.
  if (dev && new URL(dev).port === new URL(url).port) {
    throw new Error(
      `Refusing to run e2e tests against the dev database (${url}, from .env.local). ` +
        "The suite has its own stack; run it with `npm run test:e2e`.",
    );
  }
}

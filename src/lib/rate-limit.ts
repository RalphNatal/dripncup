import "server-only";

/**
 * Abuse limits, counted in Postgres (`rate_limit_hit`, a fixed-window
 * counter). Why Postgres rather than a hosted Redis such as Upstash:
 * no new vendor or secret, the counter is exact and shared across every
 * serverless instance, and at a single cafe's volume one extra indexed upsert
 * per checkout is negligible. Upstash would win on latency and on keeping
 * that write load off the database at chain scale; this file is the only
 * place that would change.
 */
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

export interface Limit {
  /** e.g. "checkout:user" */
  scope: string;
  max: number;
  windowSeconds: number;
}

export const LIMITS = {
  /** Order creation. Generous: a double-tapped Pay counts twice. */
  checkoutPerUser: { scope: "checkout:user", max: 12, windowSeconds: 600 },
  checkoutPerIp: { scope: "checkout:ip", max: 40, windowSeconds: 600 },
  /** Failed promo codes only -- guessing is the thing being limited. */
  promoFailuresPerUser: { scope: "promo:user", max: 8, windowSeconds: 900 },
  promoFailuresPerIp: { scope: "promo:ip", max: 25, windowSeconds: 900 },
  /** Catering requests: a handful an hour is plenty for a real customer. */
  cateringRequestPerUser: { scope: "catering:user", max: 5, windowSeconds: 3600 },
  cateringRequestPerIp: { scope: "catering:ip", max: 20, windowSeconds: 3600 },
  /** Starting a catering payment (each one asks Stripe for a PaymentIntent). */
  cateringPaymentPerUser: { scope: "catering-pay:user", max: 12, windowSeconds: 600 },
  cateringPaymentPerIp: { scope: "catering-pay:ip", max: 40, windowSeconds: 600 },
} satisfies Record<string, Limit>;

/**
 * The caller's IP. On Vercel the first X-Forwarded-For entry is the client,
 * set by Vercel's edge (a client-sent value is overwritten). Locally it is
 * the loopback address.
 */
export async function clientIp(): Promise<string> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() || list.get("x-real-ip") || "unknown";
}

async function call(limit: Limit, subject: string, cost: number, max: number): Promise<boolean> {
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_key: `${limit.scope}:${subject}`,
    p_limit: max,
    p_window_seconds: limit.windowSeconds,
    p_cost: cost,
  });
  if (error) {
    // An outage of the limiter must not take ordering down with it.
    console.error(`Rate limiter unavailable for ${limit.scope}`, error);
    return true;
  }
  return data === true;
}

/** Counts one hit; true while within the limit. */
export function hit(limit: Limit, subject: string): Promise<boolean> {
  return call(limit, subject, 1, limit.max);
}

/** True while there is room for at least one more hit. Counts nothing. */
export function hasRoom(limit: Limit, subject: string): Promise<boolean> {
  return call(limit, subject, 0, limit.max - 1);
}

/** A per-user and a per-IP limit together: both must pass. */
export async function hitUserAndIp(perUser: Limit, perIp: Limit, userId: string): Promise<boolean> {
  const ip = await clientIp();
  const [userOk, ipOk] = await Promise.all([hit(perUser, userId), hit(perIp, ip)]);
  return userOk && ipOk;
}

export async function hasRoomUserAndIp(perUser: Limit, perIp: Limit, userId: string): Promise<boolean> {
  const ip = await clientIp();
  const [userOk, ipOk] = await Promise.all([hasRoom(perUser, userId), hasRoom(perIp, ip)]);
  return userOk && ipOk;
}

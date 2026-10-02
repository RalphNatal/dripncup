import "server-only";

/**
 * Shared guard for the scheduled-job routes. Vercel Cron sends
 * `Authorization: Bearer <CRON_SECRET>` itself once CRON_SECRET is set in the
 * project; anything else is refused. Compared in constant time, so the secret
 * cannot be guessed a character at a time.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";

/** Null when the request may run the job; otherwise the response to send. */
export function refuseUnlessCron(request: Request): NextResponse | null {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

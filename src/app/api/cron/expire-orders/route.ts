/**
 * GET /api/cron/expire-orders -- cancels unpaid checkouts past their expiry.
 *
 * Called by Vercel Cron (see README, "Scheduled jobs"). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically once CRON_SECRET is set
 * in the project; anything else gets 401. Safe to call as often as you like.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { serverEnv } from "@/lib/env";
import { expirePendingOrders } from "@/lib/orders/expiry";

function authorised(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  // Constant-time, so the secret cannot be guessed a character at a time.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorised(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await expirePendingOrders();
    return NextResponse.json({
      cutoff: report.cutoff,
      expired: report.expired.length,
      skipped: report.skipped.length,
      failed: report.failed,
    });
  } catch (error) {
    console.error("Order expiry failed", error);
    return NextResponse.json({ error: "Expiry failed" }, { status: 500 });
  }
}

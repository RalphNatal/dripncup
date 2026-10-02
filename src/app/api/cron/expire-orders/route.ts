/**
 * GET /api/cron/expire-orders -- cancels unpaid checkouts past their expiry.
 *
 * Called by Vercel Cron (see README, "Scheduled jobs"). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically once CRON_SECRET is set
 * in the project; anything else gets 401. Safe to call as often as you like.
 */
import { NextResponse } from "next/server";

import { refuseUnlessCron } from "@/lib/cron";
import { expirePendingOrders } from "@/lib/orders/expiry";

export async function GET(request: Request) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

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

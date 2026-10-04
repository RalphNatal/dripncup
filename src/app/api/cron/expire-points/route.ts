/**
 * GET /api/cron/expire-points -- expires Overflow Rewards points past the
 * configured age (setting `loyalty.points_expire_after_months`).
 *
 * Off by default: with the setting at 0 the database function does nothing,
 * so the job can be scheduled now and switched on later as a settings change.
 * The work is all in SQL (`expire_loyalty_points`, from the ledger alone) and
 * running it twice expires nothing more. Daily is plenty (see README,
 * "Scheduled jobs"). Same cron secret as the other jobs.
 */
import { NextResponse } from "next/server";

import { refuseUnlessCron } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const { data, error } = await createAdminClient().rpc("expire_loyalty_points");
  if (error) {
    console.error("Points expiry failed", error);
    return NextResponse.json({ error: "Expiry failed" }, { status: 500 });
  }
  return NextResponse.json({ customersExpired: data ?? 0 });
}

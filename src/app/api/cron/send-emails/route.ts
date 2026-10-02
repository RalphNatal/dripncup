/**
 * GET /api/cron/send-emails -- delivers due rows from the email outbox
 * (retries, and anything a webhook or staff action did not get to).
 *
 * Same guard as the expiry job: `Authorization: Bearer <CRON_SECRET>`.
 * Safe to call as often as you like; rows are claimed, so two runs never send
 * the same email.
 */
import { NextResponse } from "next/server";

import { refuseUnlessCron } from "@/lib/cron";
import { processOutbox } from "@/lib/email/outbox";

export async function GET(request: Request) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  try {
    return NextResponse.json(await processOutbox({ limit: 50 }));
  } catch (error) {
    console.error("Email outbox run failed", error);
    return NextResponse.json({ error: "Outbox run failed" }, { status: 500 });
  }
}

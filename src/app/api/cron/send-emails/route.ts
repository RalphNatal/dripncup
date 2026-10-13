/**
 * GET /api/cron/send-emails -- delivers due rows from the email outbox and
 * the push outbox (retries, and anything a webhook or staff action did not
 * get to). The path predates push notifications and is kept so the
 * schedule (Phase 11) doesn't change.
 *
 * Same guard as the expiry job: `Authorization: Bearer <CRON_SECRET>`.
 * Safe to call as often as you like; rows are claimed, so two runs never send
 * the same email or push.
 */
import { NextResponse } from "next/server";

import { refuseUnlessCron } from "@/lib/cron";
import { processOutbox } from "@/lib/email/outbox";
import { logError } from "@/lib/log";
import { processPushOutbox } from "@/lib/push/outbox";

export async function GET(request: Request) {
  const refused = refuseUnlessCron(request);
  if (refused) return refused;

  const [emails, pushes] = await Promise.all([
    processOutbox({ limit: 50 }).catch((error) => {
      logError("cron.outbox_failed", error);
      return null;
    }),
    processPushOutbox({ limit: 50 }).catch((error) => {
      logError("cron.push_outbox_failed", error);
      return null;
    }),
  ]);
  if (!emails || !pushes) return NextResponse.json({ error: "Outbox run failed", emails, pushes }, { status: 500 });
  return NextResponse.json({ ...emails, push: pushes });
}

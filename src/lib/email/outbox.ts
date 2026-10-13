import "server-only";

/**
 * The email outbox sender.
 *
 * Rows are written by the database, in the same transaction as the change
 * that owes the email (enqueue_order_emails for orders; the catering
 * triggers for catering requests, quotes and messages). Catering reminders
 * are queued by enqueue_catering_reminders() at the start of each sweep.
 * This module delivers them afterwards:
 *
 *   claim → compose from the order as it is now → send → mark sent
 *
 * A failure is retried with backoff (1, 5, 15, 60, 240 minutes) and, after
 * the last attempt (six by default), left as `failed` for an admin to see. A row that should
 * no longer be sent (no recipient, ready-email turned off) is `skipped`.
 *
 * Push notifications have their own outbox (src/lib/push/outbox.ts), run
 * alongside this one by everything below.
 *
 * Who runs it:
 *   - kickOutbox(): after the response, from the payment webhook and the
 *     staff actions that change an order, so emails go out within seconds
 *   - GET /api/cron/send-emails: the scheduled sweep for retries
 *   - `npm run dev`: src/instrumentation.ts sweeps every 15 s, so emails
 *     owed by changes made in Supabase Studio go out too
 */
import { after } from "next/server";

import { logError, redact } from "@/lib/log";
import { processPushOutbox } from "@/lib/push/outbox";
import { createAdminClient } from "@/lib/supabase/admin";

import { composeCateringEmail, isCateringEmailKind } from "./catering-email";
import { composeOrderEmail, type EmailKind } from "./order-email";
import { emailProvider } from "./provider";
import { retryDelayMinutes } from "./retry";

export interface OutboxReport {
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
}

export async function processOutbox({ limit = 20 }: { limit?: number } = {}): Promise<OutboxReport> {
  const db = createAdminClient();
  const report: OutboxReport = { sent: 0, skipped: 0, retrying: 0, failed: 0 };

  // Reminders due before confirmed catering events (one per request, ever).
  const { error: reminderError } = await db.rpc("enqueue_catering_reminders");
  if (reminderError) console.warn(`Could not queue catering reminders: ${reminderError.message}`);

  const { data: rows, error } = await db.rpc("claim_email_outbox", { p_limit: limit });
  if (error) throw new Error(`Could not claim outbox rows: ${error.message}`);
  if (!rows?.length) return report;

  // Replies reach the cafe (Settings, Notifications), read once per sweep.
  const { data: replyRow } = await db.from("settings").select("value").eq("key", "notifications.reply_to_email").maybeSingle();
  const replyTo = typeof replyRow?.value === "string" && replyRow.value.includes("@") ? replyRow.value : null;

  for (const row of rows ?? []) {
    try {
      const email = isCateringEmailKind(row.kind)
        ? await composeCateringEmail({ ...row, kind: row.kind })
        : row.order_id
          ? await composeOrderEmail(row.kind as EmailKind, row.order_id)
          : { send: false as const, reason: "Outbox row has no order" };
      if (!email.send) {
        await db.from("email_outbox").update({ status: "skipped", last_error: email.reason, locked_at: null }).eq("id", row.id);
        report.skipped += 1;
        continue;
      }

      const provider = emailProvider();
      const { id } = await provider.send({
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo,
        idempotencyKey: row.id,
      });
      await db
        .from("email_outbox")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider: provider.name,
          provider_message_id: id,
          last_error: null,
          locked_at: null,
        })
        .eq("id", row.id);
      report.sent += 1;
    } catch (failure) {
      const message = (failure instanceof Error ? failure.message : String(failure)).slice(0, 1000);
      const giveUp = row.attempts >= row.max_attempts;
      const next = new Date(Date.now() + retryDelayMinutes(row.attempts) * 60_000).toISOString();
      await db
        .from("email_outbox")
        .update(giveUp ? { status: "failed", last_error: message, locked_at: null } : { status: "pending", last_error: message, next_attempt_at: next, locked_at: null })
        .eq("id", row.id);
      if (giveUp) {
        logError("email.failed", failure, { kind: row.kind, orderId: row.order_id, cateringRequestId: row.catering_request_id, attempts: row.attempts });
        report.failed += 1;
      } else {
        console.warn(`Email ${row.kind} for ${row.order_id ?? row.catering_request_id} failed (attempt ${row.attempts}); retrying at ${next}: ${redact(message)}`);
        report.retrying += 1;
      }
    }
  }

  return report;
}

/**
 * Sends whatever is due -- emails and push notifications -- once the current
 * response has gone out. Never throws: a delivery problem must not fail a
 * webhook or a staff action, and anything unsent is picked up by the next
 * sweep.
 */
export function kickOutbox() {
  after(async () => {
    await Promise.all([
      processPushOutbox().catch((error) => logError("push.outbox_run_failed", error)),
      processOutbox().catch((error) => logError("email.outbox_run_failed", error)),
    ]);
  });
}

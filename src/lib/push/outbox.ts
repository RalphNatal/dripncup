import "server-only";

/**
 * The push outbox sender, the twin of the email outbox (src/lib/email/
 * outbox.ts). Rows are written by the database (enqueue_order_push, when an
 * order turns Ready) in the same transaction as the status change; this
 * delivers them afterwards:
 *
 *   claim → still Ready? → the customer's devices now → encrypt and send
 *   to each → remove the ones that are gone → sent / retry / failed
 *
 * The payload is encrypted to each device with the Web Push standard
 * (aes128gcm, RFC 8291) and signed with our VAPID key (RFC 8292)
 * (./request.ts); delivery is a plain fetch, so tests can swap the
 * transport. Nothing here ever throws into a status change: it runs after
 * the response (kickOutbox) or from the sweep.
 */
import { logError } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

import { pushConfig, testPushOrigins } from "./config";
import { REMOVE_AFTER_REJECTIONS, classifyPushResponse, rowOutcome, type DeviceResult } from "./delivery";
import { isAllowedPushEndpoint } from "./endpoints";
import { orderReadyPayload } from "./payload";
import { buildPushRequest, fetchTransport, type PushTransport } from "./request";

export interface PushReport {
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
  /** Subscriptions removed because their push service said they are gone. */
  removed: number;
}

interface OutboxRow {
  id: string;
  order_id: string;
  attempts: number;
  max_attempts: number;
  delivered_to: string[];
}

export async function processPushOutbox({ limit = 20, transport = fetchTransport }: { limit?: number; transport?: PushTransport } = {}): Promise<PushReport> {
  const db = createAdminClient();
  const report: PushReport = { sent: 0, skipped: 0, retrying: 0, failed: 0, removed: 0 };

  const { data: rows, error } = await db.rpc("claim_push_outbox", { p_limit: limit });
  if (error) throw new Error(`Could not claim push outbox rows: ${error.message}`);
  if (!rows?.length) return report;

  const config = pushConfig();
  const extraOrigins = testPushOrigins();

  const finish = async (row: OutboxRow, status: "sent" | "skipped" | "failed" | "pending", fields: Record<string, unknown> = {}) => {
    await db
      .from("push_outbox")
      .update({ status, locked_at: null, ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}), ...fields })
      .eq("id", row.id);
    if (status === "pending") report.retrying += 1;
    else report[status] += 1;
  };

  for (const row of rows as OutboxRow[]) {
    try {
      if (!config) {
        await finish(row, "skipped", { last_error: "Push is not configured (VAPID keys are not set)." });
        continue;
      }

      const { data: order } = await db
        .from("orders")
        .select("id, order_number, status, user_id, locations(name)")
        .eq("id", row.order_id)
        .maybeSingle();
      if (!order?.user_id) {
        await finish(row, "skipped", { last_error: "The order or its customer is gone." });
        continue;
      }
      // Sent late (a retry, a slow sweep) after it was picked up: say nothing.
      if (order.status !== "ready") {
        await finish(row, "skipped", { last_error: `The order is ${order.status} now.` });
        continue;
      }

      const { data: devices } = await db
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth, failure_count")
        .eq("user_id", order.user_id);
      const pending = (devices ?? []).filter((device) => !row.delivered_to.includes(device.id));

      const payload = orderReadyPayload({
        orderId: order.id,
        orderNumber: order.order_number,
        locationName: (order.locations as { name: string } | null)?.name ?? "the cafe",
      });

      const results: DeviceResult[] = [];
      const delivered = [...row.delivered_to];
      const errors: string[] = [];

      for (const device of pending) {
        // Saved endpoints were checked; checked again so a bad row can never make us call it.
        if (!isAllowedPushEndpoint(device.endpoint, extraOrigins)) {
          await db.from("push_subscriptions").delete().eq("id", device.id);
          report.removed += 1;
          continue;
        }
        let status: number | null;
        try {
          ({ status } = await transport(buildPushRequest(device, payload, config)));
        } catch (failure) {
          status = null;
          errors.push(failure instanceof Error ? failure.message : String(failure));
        }
        const result = classifyPushResponse(status);
        results.push(result);
        const now = new Date().toISOString();
        if (result === "delivered") {
          delivered.push(device.id);
          await db.from("push_subscriptions").update({ last_success_at: now, failure_count: 0, last_failure_at: null }).eq("id", device.id);
        } else if (result === "gone" || (result === "rejected" && device.failure_count + 1 >= REMOVE_AFTER_REJECTIONS)) {
          await db.from("push_subscriptions").delete().eq("id", device.id);
          report.removed += 1;
        } else {
          if (status !== null) errors.push(`HTTP ${status}`);
          await db
            .from("push_subscriptions")
            .update({ last_failure_at: now, failure_count: device.failure_count + 1 })
            .eq("id", device.id);
        }
      }

      const outcome = rowOutcome({
        deliveredBefore: row.delivered_to.length,
        results,
        attempts: row.attempts,
        maxAttempts: row.max_attempts,
      });
      const lastError = errors.length ? errors.join("; ").slice(0, 500) : outcome.status === "skipped" ? "No device could take it." : null;
      await finish(row, outcome.status, {
        delivered_to: delivered,
        last_error: lastError,
        ...(outcome.retryInSeconds ? { next_attempt_at: new Date(Date.now() + outcome.retryInSeconds * 1000).toISOString() } : {}),
      });
    } catch (failure) {
      logError("push.row_failed", failure, { outboxId: row.id, orderId: row.order_id });
      await finish(row, row.attempts >= row.max_attempts ? "failed" : "pending", {
        last_error: "Unexpected error while sending.",
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
      }).catch(() => undefined);
    }
  }

  return report;
}

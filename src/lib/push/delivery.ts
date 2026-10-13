/**
 * What a push service's answer means, and what happens to an outbox row
 * after a round of sends. Pure, unit-tested; src/lib/push/outbox.ts does the
 * sending.
 *
 * Per device (RFC 8030 and the services' docs):
 *   2xx           delivered
 *   404, 410      the subscription is gone (app uninstalled, permission
 *                 revoked, expired): removed at once
 *   400, 401, 403 refused: a malformed subscription or one made for other
 *   413           VAPID keys; removed after REMOVE_AFTER_REJECTIONS in a row
 *   429, 5xx,     the service is busy or down: tried again shortly
 *   no answer
 *
 * Per outbox row: "ready" is only worth saying for a few minutes, so a row
 * is retried quickly (30 s, 2 min, 5 min) and only for devices not yet
 * reached; then it is `sent` if any device got it, `failed` if a service
 * kept failing, or `skipped` if no device could take it.
 */

export type DeviceResult = "delivered" | "gone" | "rejected" | "retry";

/** How long a push service keeps trying to reach a phone that is off or offline. */
export const PUSH_TTL_SECONDS = 30 * 60;
export const RETRY_DELAYS_SECONDS = [30, 120, 300] as const;
export const REMOVE_AFTER_REJECTIONS = 3;

/** `null` = no answer (network error, timeout). */
export function classifyPushResponse(status: number | null): DeviceResult {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "delivered";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  return "rejected";
}

export type RowStatus = "sent" | "pending" | "failed" | "skipped";

export function rowOutcome({
  deliveredBefore,
  results,
  attempts,
  maxAttempts,
}: {
  /** Devices reached in earlier attempts. */
  deliveredBefore: number;
  results: readonly DeviceResult[];
  /** Including this one. */
  attempts: number;
  maxAttempts: number;
}): { status: RowStatus; retryInSeconds?: number } {
  const delivered = deliveredBefore + results.filter((r) => r === "delivered").length;
  const retrying = results.includes("retry");
  if (retrying && attempts < maxAttempts) {
    return { status: "pending", retryInSeconds: RETRY_DELAYS_SECONDS[Math.min(attempts - 1, RETRY_DELAYS_SECONDS.length - 1)] };
  }
  if (delivered > 0) return { status: "sent" };
  return { status: retrying ? "failed" : "skipped" };
}

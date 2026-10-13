import "server-only";

/**
 * Saving, listing and removing a customer's push subscriptions. Used by the
 * Server Actions (./actions.ts) and by the service worker's resubscribe
 * route (/api/push/subscriptions).
 */
import { z } from "zod";

import { logError } from "@/lib/log";
import { LIMITS, hitUserAndIp } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { pushConfig, testPushOrigins } from "./config";
import { deviceLabel, isAllowedPushEndpoint } from "./endpoints";

/** What `PushSubscription.toJSON()` gives in the browser. */
export const subscriptionSchema = z.object({
  endpoint: z.string().trim().min(1).max(2048),
  keys: z.object({
    p256dh: z.string().trim().min(40).max(200),
    auth: z.string().trim().min(10).max(100),
  }),
});

export type SaveResult = { ok: true } | { ok: false; message: string };

const GENERIC = "We couldn't turn on notifications. Please try again.";

export async function saveSubscription(userId: string, input: unknown, userAgent: string | null): Promise<SaveResult> {
  if (!pushConfig()) return { ok: false, message: "Notifications aren't available right now." };
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success || !isAllowedPushEndpoint(parsed.data.endpoint, testPushOrigins())) {
    return { ok: false, message: "This browser's notification service isn't supported." };
  }
  if (!(await hitUserAndIp(LIMITS.pushSubscribePerUser, LIMITS.pushSubscribePerIp, userId))) {
    return { ok: false, message: "Too many tries. Please wait a few minutes." };
  }

  const { error } = await createAdminClient().rpc("save_push_subscription", {
    p_user_id: userId,
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_device_label: deviceLabel(userAgent),
  });
  if (error) {
    logError("push.subscribe_failed", error);
    return { ok: false, message: GENERIC };
  }
  return { ok: true };
}

/** Removes the signed-in customer's subscription for this endpoint (RLS: their own only). */
export async function removeSubscriptionByEndpoint(endpoint: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) logError("push.unsubscribe_failed", error);
}

export interface PushDevice {
  id: string;
  label: string;
  addedAt: string;
  lastNotifiedAt: string | null;
  /** Hashed, so the browser can tell which row is "this device" without the server echoing endpoints. */
  endpointHash: string;
}

/** SHA-256 of an endpoint, hex; the browser computes the same to find itself in the list. */
export async function hashEndpoint(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function listMyPushDevices(): Promise<PushDevice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, device_label, created_at, last_success_at")
    .order("created_at", { ascending: false });
  if (error) {
    logError("push.list_failed", error);
    return [];
  }
  return Promise.all(
    (data ?? []).map(async (row) => ({
      id: row.id,
      label: row.device_label,
      addedAt: row.created_at,
      lastNotifiedAt: row.last_success_at,
      endpointHash: await hashEndpoint(row.endpoint),
    })),
  );
}

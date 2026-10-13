/**
 * One push, as an HTTP request: the payload encrypted to the device
 * (aes128gcm, RFC 8291) and signed with our VAPID key (RFC 8292) by the
 * `web-push` library, which we use only to build the request. Sending is a
 * plain fetch (fetchTransport), swappable in tests. Server code only (it
 * needs the private key), but free of server-only imports so it can be
 * unit-tested.
 */
import webpush from "web-push";

import type { PushConfig } from "./config";
import { PUSH_TTL_SECONDS } from "./delivery";
import type { PushPayload } from "./payload";

export interface PushRequest {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

/** Sends one request; resolves with the HTTP status, or rejects on a network error. */
export type PushTransport = (request: PushRequest) => Promise<{ status: number }>;

export const fetchTransport: PushTransport = async (request) => {
  const response = await fetch(request.endpoint, {
    method: request.method,
    headers: request.headers,
    body: request.body ? Buffer.from(request.body) : undefined,
    // A push service never redirects; following one could lead anywhere.
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  await response.arrayBuffer().catch(() => undefined);
  return { status: response.status };
};

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** The encrypted, signed request for one device. */
export function buildPushRequest(subscription: Subscription, payload: PushPayload, config: PushConfig): PushRequest {
  const details = webpush.generateRequestDetails(
    { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
    JSON.stringify(payload),
    {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      TTL: PUSH_TTL_SECONDS,
      urgency: "high",
      contentEncoding: "aes128gcm",
    },
  );
  return {
    endpoint: details.endpoint,
    method: details.method,
    headers: Object.fromEntries(Object.entries(details.headers).map(([name, value]) => [name, String(value)])),
    body: details.body ? new Uint8Array(details.body) : null,
  };
}

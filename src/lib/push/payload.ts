/**
 * What a push notification carries, shared by the server that sends it
 * (src/lib/push/outbox.ts) and the service worker that shows it
 * (src/sw/sw.ts). Pure: no server or browser APIs.
 *
 * The payload is encrypted end to end (only the subscribed browser can read
 * it) but still kept minimal: the order number and pickup location, no name,
 * items or amounts.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other (no double alert from page + push). */
  tag: string;
  /** A path on this site, opened when the notification is tapped. */
  url: string;
}

export function orderReadyTag(orderId: string): string {
  return `order-ready-${orderId}`;
}

export function orderReadyPayload({ orderId, orderNumber, locationName }: { orderId: string; orderNumber: string; locationName: string }): PushPayload {
  return {
    title: "Your order is ready! 🎉",
    body: `${orderNumber} is waiting for you at ${locationName}. Mahalo!`,
    tag: orderReadyTag(orderId),
    url: `/orders/${orderId}`,
  };
}

/** A same-site path, or "/" for anything else (a push can never send someone off-site). */
export function safeNotificationPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

/** The payload from a push message, or null if it is not one of ours. */
export function parsePushPayload(data: unknown): PushPayload | null {
  if (!data || typeof data !== "object") return null;
  const { title, body, tag, url } = data as Record<string, unknown>;
  if (typeof title !== "string" || !title || typeof body !== "string" || typeof tag !== "string") return null;
  return { title: title.slice(0, 120), body: body.slice(0, 300), tag: tag.slice(0, 120), url: safeNotificationPath(url) };
}

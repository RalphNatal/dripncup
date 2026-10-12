/// <reference lib="webworker" />
/**
 * The service worker, bundled by Serwist (src/app/serwist/[path]/route.ts)
 * and served at /serwist/sw.js with scope "/".
 *
 * Caching follows src/lib/pwa/cache-rules.ts (unit-tested): hashed static
 * files and menu images are cached; public pages are network-first with the
 * last copy kept for offline; everything personal or payment-related is
 * never stored. A page that can't load offline gets /offline.
 *
 * Updates: a new worker waits (no skipWaiting) until the page asks it to
 * take over, after the customer taps "Refresh" (src/components/pwa).
 *
 * Push: shows "Your order is ready" and opens the order when tapped.
 */
import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type RuntimeCaching,
} from "serwist";

import {
  CACHE_NAMES,
  IMAGE_CACHE_LIMITS,
  OFFLINE_URL,
  PAGE_CACHE_LIMITS,
  STATIC_CACHE_LIMITS,
  cacheRuleFor,
  type CacheRule,
} from "@/lib/pwa/cache-rules";
import { parsePushPayload, safeNotificationPath } from "@/lib/push/payload";

declare const self: ServiceWorkerGlobalScope & { __SW_MANIFEST: Array<PrecacheEntry | string> | undefined };
/** Set per build (src/app/serwist/[path]/route.ts), so every deploy is a new worker. */
declare const __DRINCUP_VERSION__: string;
/** False under `npm run dev` (NEXT_PUBLIC_SW_IN_DEV): dev chunks are not content-hashed, so nothing is cached. */
declare const __DRINCUP_CACHING__: boolean;

const matches =
  (rule: CacheRule) =>
  ({ request }: { request: Request }) =>
    cacheRuleFor(request, self.location.origin) === rule;

const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: matches("static"),
    handler: new CacheFirst({
      cacheName: CACHE_NAMES.static,
      plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ ...STATIC_CACHE_LIMITS, purgeOnQuotaError: true })],
    }),
  },
  {
    matcher: matches("images"),
    handler: new CacheFirst({
      cacheName: CACHE_NAMES.images,
      plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ ...IMAGE_CACHE_LIMITS, purgeOnQuotaError: true })],
    }),
  },
  {
    matcher: matches("pages"),
    handler: new NetworkFirst({
      cacheName: CACHE_NAMES.pages,
      plugins: [new CacheableResponsePlugin({ statuses: [200] }), new ExpirationPlugin({ ...PAGE_CACHE_LIMITS, purgeOnQuotaError: true })],
    }),
  },
  // Never stored; routed only so a page that fails offline gets the offline page.
  { matcher: matches("network-only"), handler: new NetworkOnly() },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Wait for the page to say so; see the file comment.
  skipWaiting: false,
  // The first install takes control at once, so offline works from the first visit.
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: __DRINCUP_CACHING__ ? runtimeCaching : [],
  fallbacks: __DRINCUP_CACHING__
    ? { entries: [{ url: OFFLINE_URL, matcher: ({ request }) => request.mode === "navigate" }] }
    : undefined,
});

serwist.addEventListeners();

self.addEventListener("message", (event) => {
  const type = (event.data as { type?: unknown } | null)?.type;
  if (type === "SKIP_WAITING") void self.skipWaiting();
  // Signing out: pages kept for offline may show the last person's greeting.
  if (type === "CLEAR_PAGES") event.waitUntil(caches.delete(CACHE_NAMES.pages));
  if (type === "GET_VERSION") event.ports[0]?.postMessage({ version: __DRINCUP_VERSION__ });
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

self.addEventListener("push", (event) => {
  let data: unknown = null;
  try {
    data = event.data?.json();
  } catch {
    data = null;
  }
  const payload = parsePushPayload(data);
  // Chrome requires every push to show something; ours always carry a payload.
  const title = payload?.title ?? "Drincup Cafe";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload?.body ?? "You have an update on your order.",
      tag: payload?.tag ?? "drincup",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: payload?.url ?? "/orders" },
      // Not in TypeScript's lib yet; Android vibrates with it.
      ...({ vibrate: [200, 100, 200] } as NotificationOptions),
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeNotificationPath((event.notification.data as { url?: unknown } | null)?.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((client) => client.url === target) ?? windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        if (open.url !== target && "navigate" in open) await open.navigate(target).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/**
 * The browser replaced the subscription (keys rotated, or it expired): make
 * a new one with the same server key and tell the server, which swaps it for
 * the old one if this browser is still signed in.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const change = event as ExtendableEvent & { oldSubscription?: PushSubscription | null; newSubscription?: PushSubscription | null };
  change.waitUntil(
    (async () => {
      const key = change.oldSubscription?.options.applicationServerKey;
      const next =
        change.newSubscription ??
        (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
      if (!next) return;
      await fetch("/api/push/subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: next.toJSON(), replaces: change.oldSubscription?.endpoint ?? null }),
      }).catch(() => undefined);
    })(),
  );
});

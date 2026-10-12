/**
 * What the service worker (src/sw/sw.ts) does with each request. Pure, so
 * the rules are unit-tested without a browser.
 *
 *   static        /_next/static/* (content-hashed JS, CSS, fonts): cache first
 *   images        menu photos through /_next/image, and our own icons:
 *                 cache first, at most 60 entries, a week old
 *   pages         a public page's HTML: network first; the last copy is
 *                 shown when offline (with the Offline banner)
 *   network-only  any other page: never stored; offline, the offline page
 *   ignore        not touched at all: the browser handles it as if there
 *                 were no service worker
 *
 * Never cached, by construction: anything not GET; anything on another
 * origin (Supabase's API, Auth, Realtime and Storage; Stripe); /api (the
 * Stripe webhook, cron, push); /admin, /staff, /account, /orders, /checkout,
 * /cart, catering payment, sign-in and auth callbacks; Server Actions and
 * React Server Component requests (client-side navigations and prefetches).
 */

export type CacheRule = "static" | "images" | "pages" | "network-only" | "ignore";

export const CACHE_NAMES = {
  static: "drincup-static-v1",
  images: "drincup-images-v1",
  pages: "drincup-pages-v1",
} as const;

/** Served for a page that can't be fetched or found in the cache while offline. */
export const OFFLINE_URL = "/offline";

export const IMAGE_CACHE_LIMITS = { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 } as const;
export const PAGE_CACHE_LIMITS = { maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 } as const;
export const STATIC_CACHE_LIMITS = { maxEntries: 250, maxAgeSeconds: 30 * 24 * 60 * 60 } as const;

/** Public pages, the same for everyone apart from the greeting: kept for offline. */
const CACHEABLE_PAGES = [
  /^\/$/,
  /^\/menu\/?$/,
  /^\/menu\/[a-z0-9-]+\/?$/,
  /^\/rewards\/?$/,
  /^\/events\/?$/,
  /^\/events\/[a-z0-9-]+\/?$/,
  /^\/collections\/[a-z0-9-]+\/?$/,
  /^\/catering\/?$/,
  /^\/(?:about|privacy|terms|accessibility)\/?$/,
];

/** Never stored, whatever else matches. */
const NEVER_CACHED = [
  /^\/api(?:\/|$)/,
  /^\/admin(?:\/|$)/,
  /^\/staff(?:\/|$)/,
  /^\/account(?:\/|$)/,
  /^\/orders(?:\/|$)/,
  /^\/checkout(?:\/|$)/,
  /^\/cart(?:\/|$)/,
  /^\/catering\/.+/,
  /^\/auth(?:\/|$)/,
  /^\/(?:sign-in|sign-up|forgot-password)(?:\/|$)/,
  /^\/serwist(?:\/|$)/,
  /^\/offline$/,
];

const IMAGE_FILE = /\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/i;

export interface RequestLike {
  url: string;
  method: string;
  /** "navigate" for a page load. */
  mode?: string;
  headers?: { get(name: string): string | null };
}

export function isNeverCached(pathname: string): boolean {
  return NEVER_CACHED.some((pattern) => pattern.test(pathname));
}

export function cacheRuleFor(request: RequestLike, origin: string): CacheRule {
  if (request.method !== "GET") return "ignore";
  const url = new URL(request.url);
  if (url.origin !== origin) return "ignore";

  // Next's client navigations, prefetches and Server Actions: per-user and
  // per-version data that must come from the server.
  const headers = request.headers;
  if (headers?.get("rsc") || headers?.get("next-router-prefetch") || headers?.get("next-action") || url.searchParams.has("_rsc")) {
    return "ignore";
  }

  const path = url.pathname;
  const navigation = request.mode === "navigate";

  if (isNeverCached(path)) return navigation ? "network-only" : "ignore";
  if (path.startsWith("/_next/static/")) return "static";
  if (path === "/_next/image" || path.startsWith("/icons/") || (!navigation && IMAGE_FILE.test(path))) return "images";
  if (navigation) return CACHEABLE_PAGES.some((pattern) => pattern.test(path)) ? "pages" : "network-only";
  return "ignore";
}

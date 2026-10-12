/**
 * Serves the service worker (/serwist/sw.js) from src/sw/sw.ts, bundled by
 * Serwist with esbuild at build time (its Turbopack integration: Turbopack
 * has no plugin to do it during the build itself).
 *
 * Precached at install: only the offline page and the icon it shows.
 * Serwist's default would precache every JavaScript chunk in the app, the
 * admin's included, megabytes a customer's phone never needs; pages and
 * chunks are cached as they are used instead (src/lib/pwa/cache-rules.ts).
 *
 * __DRINCUP_VERSION__ differs on every build, so every deploy is a new
 * worker and the "new version" prompt appears.
 */
import { createHash } from "node:crypto";

import { createSerwistRoute } from "@serwist/turbopack";

import { OFFLINE_URL } from "@/lib/pwa/cache-rules";
import { offlinePageHtml } from "@/lib/pwa/offline-page";

const version = process.env.NEXT_DEPLOYMENT_ID || process.env.VERCEL_DEPLOYMENT_ID || `build-${Date.now().toString(36)}`;
const offlineRevision = createHash("sha256").update(offlinePageHtml()).digest("hex").slice(0, 16);

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/sw/sw.ts",
  globDirectory: process.cwd(),
  globPatterns: ["public/icons/icon-192.png"],
  additionalPrecacheEntries: [{ url: OFFLINE_URL, revision: offlineRevision }],
  useNativeEsbuild: true,
  esbuildOptions: {
    // A classic script: module service workers are not supported everywhere yet.
    format: "iife",
    sourcemap: false,
    define: {
      __DRINCUP_VERSION__: JSON.stringify(version),
      // Dev chunks are not content-hashed: under `npm run dev` the worker caches nothing.
      __DRINCUP_CACHING__: JSON.stringify(process.env.NODE_ENV === "production"),
    },
  },
});

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
 * __DRINCUP_VERSION__ is this build's id, so every deploy is a new worker
 * and the "new version" prompt appears -- and only then. The route is
 * prerendered, but `revalidatePath("/", "layout")` (sign-in, sign-out,
 * admin saves) reaches every route, this one included, and Next then
 * renders it again on the server. That copy must be byte-for-byte the
 * build's, or every browser would see a "new version" after anyone signed
 * in (and checkout would ask for a refresh before paying). So the version
 * is read, not made up: the deployment id where there is one, else the
 * build id Next wrote before prerendering, and Serwist's route is created
 * per version, never from a value read earlier in the build.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createSerwistRoute } from "@serwist/turbopack";

import { OFFLINE_URL } from "@/lib/pwa/cache-rules";
import { offlinePageHtml } from "@/lib/pwa/offline-page";

type SerwistRoute = ReturnType<typeof createSerwistRoute>;

const offlineRevision = createHash("sha256").update(offlinePageHtml()).digest("hex").slice(0, 16);

/** The same value in the build that prerendered this route and in the server that renders it again. */
function buildVersion(): string {
  const deployment = process.env.VERCEL_DEPLOYMENT_ID || process.env.NEXT_DEPLOYMENT_ID;
  if (deployment) return deployment;
  try {
    return readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "development";
  }
}

let current: { version: string; route: SerwistRoute } | null = null;

function serwistRoute(): SerwistRoute {
  const version = buildVersion();
  if (current?.version !== version) {
    current = {
      version,
      route: createSerwistRoute({
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
      }),
    };
  }
  return current.route;
}

export const dynamic = "force-static";
export const dynamicParams = false;
export const revalidate = false;

export function generateStaticParams() {
  return serwistRoute().generateStaticParams();
}

export function GET(...args: Parameters<SerwistRoute["GET"]>) {
  return serwistRoute().GET(...args);
}

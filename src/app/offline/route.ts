/**
 * GET /offline -- the page the service worker shows when a page can't load
 * offline (src/lib/pwa/offline-page.ts). Built once at build time; the
 * worker precaches it with a revision of its content.
 */
import { OFFLINE_PAGE_CSP, offlinePageHtml } from "@/lib/pwa/offline-page";

export const dynamic = "force-static";

export function GET() {
  return new Response(offlinePageHtml(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": OFFLINE_PAGE_CSP,
      "X-Robots-Tag": "noindex",
    },
  });
}

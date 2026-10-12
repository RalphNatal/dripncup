import type { NextRequest } from "next/server";

import { clientEnv } from "@/lib/env";
import { NONCE_HEADER, REQUEST_ID_HEADER } from "@/lib/request-headers";
import { buildCsp, newNonce } from "@/lib/security/headers";
import { updateSession } from "@/lib/supabase/session";

/**
 * Every page request:
 *   - a fresh CSP nonce. Next reads the policy from the request headers and
 *     puts the nonce on its own scripts; the browser gets the same policy
 *   - a request id, on the response (X-Request-Id) and in the server's error
 *     logs, so a report from a customer can be matched to a log line
 *   - the Supabase session refresh and route protection (updateSession)
 *
 * The other security headers are static and set in next.config.ts.
 */
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const requestId = crypto.randomUUID();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
  });

  const response = await updateSession(request, {
    [NONCE_HEADER]: nonce,
    "content-security-policy": csp,
    [REQUEST_ID_HEADER]: requestId,
  });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and image files. Auth cookies still need
     * refreshing on public pages, so this deliberately does not narrow to the
     * protected prefixes -- `updateSession` decides what to gate.
     *
     * Also skipped: machine-to-machine routes that carry no session and
     * authenticate themselves (Stripe signature, cron secret); the service
     * worker and the offline page it keeps (they set their own headers, and
     * a worker update check must not refresh a session); robots.txt and the
     * sitemap.
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|splash/|serwist/|offline$|manifest.webmanifest|robots.txt|sitemap.xml|api/webhooks/|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};

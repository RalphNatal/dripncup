import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/session";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /**
     * Everything except static assets and image files. Auth cookies still need
     * refreshing on public pages, so this deliberately does not narrow to the
     * protected prefixes -- `updateSession` decides what to gate.
     *
     * Also skipped: machine-to-machine routes that carry no session and
     * authenticate themselves (Stripe signature, cron secret).
     */
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|api/webhooks/|api/cron/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?)$).*)",
  ],
};

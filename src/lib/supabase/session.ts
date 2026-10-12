/**
 * Session refresh + route protection, run from `src/proxy.ts` on every matched
 * request (Next 16 renamed the middleware convention to "proxy").
 *
 * Two jobs:
 *   1. Refresh the Supabase auth cookie so Server Components always see a live
 *      session. Without this, tokens expire mid-visit and users get bounced.
 *   2. Gate the routes in `@/lib/auth/roles` before any page code runs, and
 *      send signed-in visitors past the sign-in and sign-up pages.
 *
 * The role check hits the database rather than reading a JWT claim, because a
 * role change must take effect immediately -- not whenever the access token
 * next rotates.
 *
 * The page render receives `forwardHeaders` (the CSP nonce and the request
 * id, from the proxy) plus `x-dc-viewer`: "guest", "signed-in", or the role
 * when this request needed it. Error logs record that, never who the user is.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { findRouteRule, isGuestOnlyRoute } from "@/lib/auth/roles";
import { clientEnv } from "@/lib/env";
import { VIEWER_HEADER } from "@/lib/request-headers";
import type { Database } from "@/types/database";

/**
 * Redirects while keeping any refreshed auth cookies. Returning a bare
 * `NextResponse.redirect` would drop them, and the browser would keep
 * presenting a token that has just been rotated out.
 */
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

/** The request's headers (including any cookies refreshed above) plus ours. */
function forwarded(request: NextRequest, extra: Record<string, string>) {
  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return headers;
}

export async function updateSession(request: NextRequest, forwardHeaders: Record<string, string> = {}) {
  // Set from the start so a client can never supply its own.
  let viewer = "guest";
  const extra = () => ({ ...forwardHeaders, [VIEWER_HEADER]: viewer });
  let response = NextResponse.next({ request: { headers: forwarded(request, extra()) } });

  const supabase = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: forwarded(request, extra()) } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not remove: this call is what actually refreshes the session cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // Already signed in: skip the sign-in form and go where they were headed.
  if (user && isGuestOnlyRoute(pathname)) {
    const onward = new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.url);
    return redirectWithCookies(onward, response);
  }

  if (user) viewer = "signed-in";
  const rule = findRouteRule(pathname);

  if (rule) {
    if (!user) {
      const signIn = request.nextUrl.clone();
      signIn.pathname = "/sign-in";
      // Send them back where they were headed once they are in.
      signIn.search = "";
      signIn.searchParams.set("next", `${pathname}${search}`);
      return redirectWithCookies(signIn, response);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, deleted_at")
      .eq("id", user.id)
      .single();

    if (!profile || profile.deleted_at || !rule.roles.includes(profile.role)) {
      const home = request.nextUrl.clone();
      home.pathname = "/";
      home.search = "";
      return redirectWithCookies(home, response);
    }
    viewer = profile.role;
  }

  // The render gets the final viewer; the cookies refreshed above go with it.
  const final = NextResponse.next({ request: { headers: forwarded(request, extra()) } });
  for (const cookie of response.cookies.getAll()) final.cookies.set(cookie);
  return final;
}

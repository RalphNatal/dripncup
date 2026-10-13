/**
 * POST /api/push/subscriptions  { "subscription": {...}, "replaces": "<old endpoint>" | null }
 *
 * For the service worker only: when the browser replaces a push
 * subscription (`pushsubscriptionchange`, src/sw/sw.ts) there is no page to
 * run a Server Action from. Swaps the old subscription for the new one if
 * this browser is still signed in; otherwise does nothing (the customer
 * turns notifications back on next time).
 *
 * Session-authenticated, so it accepts only same-origin JSON requests, like
 * the staff cancel route.
 */
import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth/dal";
import { removeSubscriptionByEndpoint, saveSubscription } from "@/lib/push/subscriptions";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin || !request.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { subscription?: unknown; replaces?: unknown } | null;
  if (typeof body?.replaces === "string" && body.replaces.length <= 2048) await removeSubscriptionByEndpoint(body.replaces);

  const result = await saveSubscription(profile.id, body?.subscription, request.headers.get("user-agent"));
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

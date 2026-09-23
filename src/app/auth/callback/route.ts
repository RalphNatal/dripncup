/**
 * Landing point for every emailed auth link: sign-up confirmation, password
 * reset and email change.
 *
 * Supabase's default templates send a PKCE `code`; custom templates can send
 * `token_hash` + `type` instead. Either way the session cookie is written here
 * and the visitor continues to `next`, which is sanitised so the link cannot
 * be turned into an open redirect.
 */
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function isOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (OTP_TYPES as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  const supabase = await createClient();
  let verified = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    verified = !error;
  } else if (tokenHash && isOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    verified = !error;
  }

  if (verified) {
    return NextResponse.redirect(new URL(next, request.url));
  }

  // Expired, already used, or opened in a different browser from the one
  // that requested it (PKCE ties the code to that browser's cookie).
  const failure = new URL("/sign-in", request.url);
  failure.searchParams.set("error", "link");
  return NextResponse.redirect(failure);
}

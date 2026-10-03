"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { requireRole } from "@/lib/auth/dal";
import { clientEnv } from "@/lib/env";

import { STAFF_LOCATION_COOKIE, STAFF_LOCATION_COOKIE_MAX_AGE, getStaffLocationOptions } from "./locations";

export type RememberLocationResult = { ok: true } | { ok: false; message: string };

/**
 * Remembers which counter this device shows. Only a location the signed-in
 * staff member may open today is accepted; the page re-checks on every load
 * anyway, so the cookie is a preference, never a permission.
 */
export async function rememberStaffLocation(locationId: unknown): Promise<RememberLocationResult> {
  const profile = await requireRole(["staff", "admin"], "/staff");
  const parsed = z.guid().safeParse(locationId);
  if (!parsed.success) return { ok: false, message: "That location isn't available." };

  const options = await getStaffLocationOptions(profile);
  if (!options.some((o) => o.id === parsed.data)) {
    return { ok: false, message: "You're not rostered at that location today." };
  }

  (await cookies()).set(STAFF_LOCATION_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    path: "/staff",
    maxAge: STAFF_LOCATION_COOKIE_MAX_AGE,
    secure: clientEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
  });
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { clientEnv } from "@/lib/env";

import { LOCATION_COOKIE, LOCATION_COOKIE_MAX_AGE } from "./cookie";
import { getStorefront } from "./storefront";

export type SelectLocationResult = { ok: true; locationId: string } | { ok: false; message: string };

/**
 * Remembers the customer's pickup location. Accepts only a location that is
 * currently offered (the cafe or a live / upcoming pop-up), so a hand-crafted
 * id for an ended or hidden event cannot be selected.
 */
export async function selectLocation(locationId: unknown): Promise<SelectLocationResult> {
  const parsed = z.uuid().safeParse(locationId);
  if (!parsed.success) return { ok: false, message: "That location isn't available." };

  const { locations } = await getStorefront();
  if (!locations.some((l) => l.id === parsed.data)) {
    return { ok: false, message: "That location isn't available right now." };
  }

  (await cookies()).set(LOCATION_COOKIE, parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: LOCATION_COOKIE_MAX_AGE,
    secure: clientEnv.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
  });

  // Every page under the shell shows location-specific status and menus.
  revalidatePath("/", "layout");
  return { ok: true, locationId: parsed.data };
}

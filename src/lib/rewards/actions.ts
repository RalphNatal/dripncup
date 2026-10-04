"use server";

/**
 * Server Actions for the rewards page and the checkout's reward picker. Each
 * re-checks who is calling; the database functions check again.
 */
import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/dal";
import { cancelUnpaidCheckout } from "@/lib/orders/expiry";
import { createClient } from "@/lib/supabase/server";

import { getHeldPoints, listPointsActivity, type ActivityPage } from "./queries";

export async function loadMorePointsActivityAction(cursor: unknown): Promise<ActivityPage | { error: string }> {
  if (typeof cursor !== "string" || cursor.length > 100) return { error: "Couldn't load more activity." };
  if (!(await getCurrentProfile())) return { error: "Sign in to see your points." };
  return listPointsActivity(cursor);
}

/** A new member code; the old one stops working. */
export async function regenerateMemberCodeAction(): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  if (!(await getCurrentProfile())) return { ok: false, message: "Sign in to change your member code." };
  const { data, error } = await (await createClient()).rpc("regenerate_member_code");
  if (error || !data) return { ok: false, message: "We couldn't make a new code. Please try again." };
  revalidatePath("/rewards");
  revalidatePath("/account");
  return { ok: true, code: data };
}

const RELEASED_REASON = "Checkout cancelled to free up its reward points.";

/**
 * Gives back points held by the customer's unfinished checkouts (another tab,
 * or one abandoned earlier), instead of waiting for them to expire. Each
 * checkout's payment is cancelled first; one whose payment is already going
 * through is left alone.
 */
export async function releaseHeldPointsAction(): Promise<{ ok: true; released: number; stillPaying: number } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };

  const held = await getHeldPoints(profile.id);
  let released = 0;
  let stillPaying = 0;
  for (const orderId of held.orderIds) {
    try {
      const outcome = await cancelUnpaidCheckout(orderId, RELEASED_REASON);
      if (outcome === "cancelled") released += 1;
      else if (outcome === "money_on_its_way") stillPaying += 1;
    } catch (error) {
      console.error(`Could not release points held by order ${orderId}`, error);
      return { ok: false, message: "We couldn't free your points just now. Please try again." };
    }
  }
  revalidatePath("/rewards");
  return { ok: true, released, stillPaying };
}

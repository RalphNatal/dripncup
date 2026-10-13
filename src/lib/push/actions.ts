"use server";

/**
 * "Notify me when it's ready": turning push notifications on and off for
 * this device, and removing other devices, from the tracker and Account →
 * Notifications. Never called on page load; only from a button.
 */
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

import { removeSubscriptionByEndpoint, saveSubscription, type SaveResult } from "./subscriptions";

export async function savePushSubscriptionAction(subscription: unknown): Promise<SaveResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in to turn on notifications." };
  const result = await saveSubscription(profile.id, subscription, (await headers()).get("user-agent"));
  if (result.ok) revalidatePath("/account");
  return result;
}

/** This device's subscription (by endpoint), when the customer turns notifications off or signs out. */
export async function removePushSubscriptionAction(endpoint: unknown): Promise<void> {
  const parsed = z.string().min(1).max(2048).safeParse(endpoint);
  if (!parsed.success || !(await getCurrentProfile())) return;
  await removeSubscriptionByEndpoint(parsed.data);
  revalidatePath("/account");
}

/** Another device, from the list in Account → Notifications (RLS: the customer's own only). */
export async function removePushDeviceAction(id: unknown): Promise<{ ok: boolean }> {
  const parsed = z.guid().safeParse(id);
  if (!parsed.success || !(await getCurrentProfile())) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").delete().eq("id", parsed.data);
  revalidatePath("/account");
  return { ok: !error };
}

import "server-only";

/**
 * Overflow Rewards reads for pages and checkout. The balance is always the
 * cached ledger sum on the profile (kept by a database trigger), never added
 * up here or in the browser.
 */
import { getCurrentProfile } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

import {
  ACTIVITY_PAGE_SIZE,
  decodeActivityCursor,
  encodeActivityCursor,
  toActivityEntry,
  type ActivityEntry,
} from "./activity";
import {
  REWARD_COLUMNS,
  REWARDS_SETTING_KEYS,
  rewardsSettingsFrom,
  sortTiers,
  tierProgress,
  toRewardTier,
  type RewardTier,
  type RewardsSettings,
  type TierProgress,
} from "./model";

/** Read fresh: a settings change applies to the next page view. */
export async function getRewardsSettings(): Promise<RewardsSettings> {
  const { data, error } = await createPublicClient({ live: true })
    .from("settings")
    .select("key, value")
    .in("key", [...REWARDS_SETTING_KEYS]);
  if (error) throw new Error(`Could not load rewards settings: ${error.message}`);
  return rewardsSettingsFrom(data ?? []);
}

/** Active tiers, cheapest first. */
export async function getRewardTiers(): Promise<RewardTier[]> {
  const { data, error } = await createPublicClient({ live: true })
    .from("rewards")
    .select(REWARD_COLUMNS)
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(`Could not load rewards: ${error.message}`);
  return sortTiers((data ?? []).map(toRewardTier));
}

/** Points a customer's unpaid checkouts are holding. */
export interface HeldPoints {
  /** Held by other checkouts (another tab, or one abandoned earlier). */
  points: number;
  /** Those checkouts' orders, oldest first. */
  orderIds: string[];
  /** Held by the attempts named in `ownIdempotencyKeys`: this browser's own. */
  ownPoints: number;
}

export async function getHeldPoints(userId: string, ownIdempotencyKeys: readonly string[] = []): Promise<HeldPoints> {
  const { data, error } = await createAdminClient()
    .from("loyalty_reservations")
    .select("points, order_id, created_at, orders!inner(idempotency_key, status)")
    .eq("user_id", userId)
    .eq("status", "held")
    .order("created_at");
  if (error) throw new Error(`Could not load held points: ${error.message}`);
  const pending = (data ?? []).filter((row) => row.orders.status === "pending_payment");
  const own = pending.filter((row) => ownIdempotencyKeys.includes(row.orders.idempotency_key));
  const others = pending.filter((row) => !ownIdempotencyKeys.includes(row.orders.idempotency_key));
  return {
    points: others.reduce((sum, row) => sum + row.points, 0),
    orderIds: others.map((row) => row.order_id),
    ownPoints: own.reduce((sum, row) => sum + row.points, 0),
  };
}

export interface MyRewards {
  settings: RewardsSettings;
  tiers: RewardTier[];
  balance: number;
  progress: TierProgress;
  heldPoints: number;
  memberCode: string;
}

/** Everything the rewards page and Home need for the signed-in customer; null when signed out. */
export async function getMyRewards(): Promise<MyRewards | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  const [settings, tiers, held] = await Promise.all([getRewardsSettings(), getRewardTiers(), getHeldPoints(profile.id)]);
  return {
    settings,
    tiers,
    balance: profile.loyalty_points,
    progress: tierProgress(profile.loyalty_points, tiers),
    heldPoints: held.points,
    memberCode: profile.member_code,
  };
}

export interface ActivityPage {
  entries: ActivityEntry[];
  nextCursor: string | null;
}

/** The signed-in customer's points activity, newest first. */
export async function listPointsActivity(cursor?: string | null, limit = ACTIVITY_PAGE_SIZE): Promise<ActivityPage> {
  const after = decodeActivityCursor(cursor);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_points_activity", {
    p_before_created_at: after?.createdAt,
    p_before_id: after?.id,
    p_limit: limit + 1,
  });
  if (error) throw new Error(`Could not load points activity: ${error.message}`);
  const rows = (data ?? []).map(toActivityEntry);
  const entries = rows.slice(0, limit);
  return { entries, nextCursor: rows.length > limit ? encodeActivityCursor(entries[entries.length - 1]) : null };
}

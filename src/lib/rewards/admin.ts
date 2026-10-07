import "server-only";

/** Rewards for the admin: every tier (switched off too), programme totals, members. */
import { createClient } from "@/lib/supabase/server";

import { REWARD_COLUMNS, toRewardTier, type RewardTier } from "./model";

export interface AdminTier extends RewardTier {
  isActive: boolean;
}

export async function listAdminTiers(): Promise<AdminTier[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("rewards").select(`${REWARD_COLUMNS}, is_active`).order("sort_order").order("points_cost");
  if (error) throw new Error(`Rewards: ${error.message}`);
  return (data ?? []).map((row) => ({ ...toRewardTier(row), isActive: row.is_active }));
}

export interface RewardsTotals {
  issued: number;
  redeemed: number;
  reversed: number;
  expired: number;
  adjustedOut: number;
  outstanding: number;
  membersWithPoints: number;
}

export async function getRewardsTotals(): Promise<RewardsTotals> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_rewards_totals");
  if (error) throw new Error(`Rewards: ${error.message}`);
  const t = (data ?? {}) as Record<string, number>;
  return {
    issued: Number(t.issued ?? 0),
    redeemed: Number(t.redeemed ?? 0),
    reversed: Number(t.reversed ?? 0),
    expired: Number(t.expired ?? 0),
    adjustedOut: Number(t.adjusted_out ?? 0),
    outstanding: Number(t.outstanding ?? 0),
    membersWithPoints: Number(t.members_with_points ?? 0),
  };
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  fullName: string | null;
  role: "customer" | "staff" | "admin";
  points: number;
  memberCode: string;
  createdAt: string;
}

/** Search by name, email or member code; filter by role. */
export async function searchUsers(query: string, role: AdminUserRow["role"] | null, page: number, pageSize = 25): Promise<{ rows: AdminUserRow[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_users", {
    p_query: query || undefined,
    p_role: role ?? undefined,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) throw new Error(`Users: ${error.message}`);
  return {
    total: Number(data?.[0]?.total_count ?? 0),
    rows: (data ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      role: u.role,
      points: u.loyalty_points,
      memberCode: u.member_code,
      createdAt: u.created_at,
    })),
  };
}

export interface LedgerEntry {
  id: string;
  type: string;
  points: number;
  description: string | null;
  createdAt: string;
  orderId: string | null;
  orderNumber: string | null;
  by: string | null;
}

/** A member's ledger, newest first (admins read every row). */
export async function memberActivity(userId: string, limit = 50): Promise<LedgerEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loyalty_transactions")
    .select("id, type, points, description, created_at, order_id, created_by, order:orders(order_number)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Rewards: ${error.message}`);
  const adminIds = [...new Set((data ?? []).map((r) => r.created_by).filter((id): id is string => Boolean(id)))];
  const { data: admins } = adminIds.length ? await supabase.from("profiles").select("id, full_name, email").in("id", adminIds) : { data: [] };
  return (data ?? []).map((r) => {
    const by = admins?.find((a) => a.id === r.created_by);
    return {
      id: r.id,
      type: r.type,
      points: r.points,
      description: r.description,
      createdAt: r.created_at,
      orderId: r.order_id,
      orderNumber: r.order?.order_number ?? null,
      by: by ? by.full_name || by.email : null,
    };
  });
}

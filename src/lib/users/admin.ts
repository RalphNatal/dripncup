import "server-only";

/** One user, as the admin sees them: profile, role, rosters, recent orders, catering, points. */
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export interface AdminUserDetail {
  id: string;
  email: string | null;
  fullName: string | null;
  firstName: string | null;
  phone: string | null;
  role: Enums<"user_role">;
  points: number;
  memberCode: string;
  marketingOptIn: boolean;
  createdAt: string;
  staffLocations: string[];
  orders: { id: string; orderNumber: string; status: Enums<"order_status">; totalCents: number; createdAt: string }[];
  catering: { id: string; requestNumber: string; status: Enums<"catering_status">; eventAt: string }[];
}

export async function getAdminUser(id: string): Promise<AdminUserDetail | null> {
  const supabase = await createClient();
  const { data: p } = await supabase
    .from("profiles")
    .select("id, email, full_name, first_name, phone, role, loyalty_points, member_code, marketing_opt_in, created_at, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!p || p.deleted_at) return null;
  const [rosters, orders, catering] = await Promise.all([
    supabase.from("staff_locations").select("location_id").eq("profile_id", id),
    supabase.from("orders").select("id, order_number, status, total_cents, created_at").eq("user_id", id).neq("status", "pending_payment").order("created_at", { ascending: false }).limit(10),
    supabase.from("catering_requests").select("id, request_number, status, event_at").eq("user_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  return {
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    firstName: p.first_name,
    phone: p.phone,
    role: p.role,
    points: p.loyalty_points,
    memberCode: p.member_code,
    marketingOptIn: p.marketing_opt_in,
    createdAt: p.created_at,
    staffLocations: (rosters.data ?? []).map((r) => r.location_id),
    orders: (orders.data ?? []).map((o) => ({ id: o.id, orderNumber: o.order_number, status: o.status, totalCents: o.total_cents, createdAt: o.created_at })),
    catering: (catering.data ?? []).map((c) => ({ id: c.id, requestNumber: c.request_number, status: c.status, eventAt: c.event_at })),
  };
}

/** Counters a barista can be rostered to: the cafe and pop-ups that have not ended. */
export async function rosterableLocations(now: Date): Promise<{ id: string; name: string; type: "cafe" | "event" }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("locations").select("id, name, type, ends_at, starts_at, is_active").order("type").order("starts_at", { nullsFirst: true });
  return (data ?? [])
    .filter((l) => l.is_active && (l.type === "cafe" || (l.ends_at && new Date(l.ends_at) > now)))
    .map((l) => ({ id: l.id, name: l.name, type: l.type }));
}

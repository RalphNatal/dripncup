import "server-only";

import { createClient } from "@/lib/supabase/server";

import type { AdminPromo } from "./admin";

export async function listAdminPromos(): Promise<AdminPromo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_list_promos");
  if (error) throw new Error(`Promos: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    code: p.code,
    description: p.description,
    type: p.type,
    percent: p.percent === null ? null : Number(p.percent),
    amountCents: p.amount_cents,
    minSpendCents: p.min_spend_cents,
    maxDiscountCents: p.max_discount_cents,
    usageLimit: p.usage_limit,
    perUserLimit: p.per_user_limit,
    timesUsed: p.times_used,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    isActive: p.is_active,
    discountGivenCents: Number(p.discount_given_cents),
    redemptions: Number(p.redemptions),
  }));
}

export async function listPromoRedemptions(promoId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_promo_redemptions", { p_promo_id: promoId });
  if (error) throw new Error(`Promos: ${error.message}`);
  return (data ?? []).map((r) => ({
    orderId: r.order_id,
    orderNumber: r.order_number,
    redeemedAt: r.redeemed_at,
    customerFirstName: r.customer_first_name,
    amountCents: r.amount_cents,
  }));
}

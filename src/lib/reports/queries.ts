import "server-only";

/**
 * Report data, aggregated by the admin_report_* SQL functions (which check
 * the caller is an admin). Run as the signed-in admin, never the service
 * role.
 */
import { createClient } from "@/lib/supabase/server";

import type { OrderExportRow, ReportRange, SalesDay } from "./definitions";

type Range = Pick<ReportRange, "from" | "to">;

function args(range: Range, locationId: string | null) {
  return { p_from: range.from, p_to: range.to, p_location_id: locationId ?? undefined };
}

function rows<T>(result: { data: T[] | null; error: { message: string } | null }, label: string): T[] {
  if (result.error) throw new Error(`Reports: could not load ${label} (${result.error.message})`);
  return result.data ?? [];
}

export async function getSalesDays(range: Range, locationId: string | null): Promise<SalesDay[]> {
  const supabase = await createClient();
  return rows(await supabase.rpc("admin_report_sales", args(range, locationId)), "sales").map((r) => ({
    businessDate: r.business_date,
    orders: Number(r.orders),
    grossSalesCents: Number(r.gross_sales_cents),
    promoDiscountCents: Number(r.promo_discount_cents),
    rewardDiscountCents: Number(r.reward_discount_cents),
    refundedCents: Number(r.refunded_cents),
    refundedSalesCents: Number(r.refunded_sales_cents),
    netSalesCents: Number(r.net_sales_cents),
    taxCents: Number(r.tax_cents),
    tipCents: Number(r.tip_cents),
    netBeforeRefundsCents: Number(r.net_before_refunds_cents),
    collectedCents: Number(r.collected_cents),
  }));
}

export async function getOrderExport(range: Range, locationId: string | null): Promise<OrderExportRow[]> {
  const supabase = await createClient();
  return rows(await supabase.rpc("admin_report_orders", args(range, locationId)), "orders").map((r) => ({
    orderNumber: r.order_number,
    businessDate: r.business_date,
    placedAt: r.placed_at,
    locationName: r.location_name,
    status: r.status,
    customerFirstName: r.customer_first_name,
    itemCount: r.item_count,
    grossSalesCents: r.gross_sales_cents,
    promoDiscountCents: r.promo_discount_cents,
    rewardDiscountCents: r.reward_discount_cents,
    netBeforeRefundsCents: r.net_before_refunds_cents,
    taxCents: r.tax_cents,
    tipCents: r.tip_cents,
    totalCents: r.total_cents,
    refundedCents: r.refunded_cents,
    refundedSalesCents: r.refunded_sales_cents,
    refundedTaxCents: r.refunded_tax_cents,
    refundedTipCents: r.refunded_tip_cents,
    netSalesCents: r.net_sales_cents,
    netTaxCents: r.net_tax_cents,
    netTipCents: r.net_tip_cents,
    promoCode: r.promo_code,
    rewards: r.rewards,
    pointsEarned: r.points_earned,
    pointsRedeemed: r.points_redeemed,
    paymentMethod: r.payment_method,
  }));
}

export interface ProductRow {
  name: string;
  quantity: number;
  revenueCents: number;
  orders: number;
}

export async function getTopProducts(range: Range, locationId: string | null, limit = 10): Promise<ProductRow[]> {
  const supabase = await createClient();
  return rows(await supabase.rpc("admin_report_products", { ...args(range, locationId), p_limit: limit }), "products").map((r) => ({
    name: r.product_name,
    quantity: Number(r.quantity),
    revenueCents: Number(r.revenue_cents),
    orders: Number(r.orders),
  }));
}

export interface ModifierRow {
  groupName: string;
  optionName: string;
  quantity: number;
  revenueCents: number;
}

export async function getTopModifiers(range: Range, locationId: string | null, limit = 10): Promise<ModifierRow[]> {
  const supabase = await createClient();
  return rows(await supabase.rpc("admin_report_modifiers", { ...args(range, locationId), p_limit: limit }), "modifiers").map((r) => ({
    groupName: r.group_name,
    optionName: r.option_name,
    quantity: Number(r.quantity),
    revenueCents: Number(r.revenue_cents),
  }));
}

export interface PeakCell {
  weekday: number;
  hour: number;
  orders: number;
}

export async function getPeakHours(range: Range, locationId: string | null): Promise<PeakCell[]> {
  const supabase = await createClient();
  return rows(await supabase.rpc("admin_report_peak_hours", args(range, locationId)), "peak hours").map((r) => ({
    weekday: r.weekday,
    hour: r.hour,
    orders: Number(r.orders),
  }));
}

export interface DiscountRow {
  kind: "promo" | "reward";
  name: string;
  uses: number;
  discountCents: number;
  points: number;
}

export async function getDiscountUsage(range: Range, locationId: string | null): Promise<DiscountRow[]> {
  const supabase = await createClient();
  return rows(await supabase.rpc("admin_report_discounts", args(range, locationId)), "discounts").map((r) => ({
    kind: r.kind as "promo" | "reward",
    name: r.name,
    uses: Number(r.uses),
    discountCents: Number(r.discount_cents),
    points: Number(r.points),
  }));
}

export interface CateringRow {
  requestId: string;
  requestNumber: string;
  paidDate: string;
  eventAt: string;
  status: string;
  contactName: string;
  headcount: number;
  itemsCents: number;
  discountCents: number;
  deliveryFeeCents: number;
  taxCents: number;
  gratuityCents: number;
  totalCents: number;
  refundedCents: number;
  netCents: number;
}

export async function getCateringRevenue(range: Range, locationId: string | null): Promise<CateringRow[]> {
  const supabase = await createClient();
  return rows(await supabase.rpc("admin_report_catering", args(range, locationId)), "catering").map((r) => ({
    requestId: r.request_id,
    requestNumber: r.request_number,
    paidDate: r.paid_date,
    eventAt: r.event_at,
    status: r.status,
    contactName: r.contact_name,
    headcount: r.headcount,
    itemsCents: r.items_cents,
    discountCents: r.discount_cents,
    deliveryFeeCents: r.delivery_fee_cents,
    taxCents: r.tax_cents,
    gratuityCents: r.gratuity_cents,
    totalCents: r.total_cents,
    refundedCents: r.refunded_cents,
    netCents: r.net_cents,
  }));
}

/** Locations and events reports can be filtered by, newest events last. */
export async function listReportLocations(): Promise<{ id: string; name: string; type: "cafe" | "event"; startsAt: string | null }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("locations").select("id, name, type, starts_at").order("type").order("starts_at", { ascending: false, nullsFirst: true });
  return (data ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type, startsAt: l.starts_at }));
}

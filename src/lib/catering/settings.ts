import "server-only";

/**
 * Catering settings, read fresh (an admin edit applies to the next request
 * or quote). Every value the cafe has not confirmed is one of these, with
 * the default seeded by the catering migration; the fallbacks below are only
 * for a missing row.
 */
import { SETTING_FALLBACKS } from "@/lib/brand";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CateringSettings {
  minLeadTimeHours: number;
  paymentDeadlineHours: number;
  quoteValidDays: number;
  deliveryOffered: boolean;
  deliveryZipCodes: string[];
  deliveryFeeCents: number;
  deliveryFeeTaxable: boolean;
  gratuityTaxable: boolean;
  taxRate: number;
  adminNotificationEmail: string | null;
  refundPolicy: string;
  cateringEarnsPoints: boolean;
}

const KEYS = [
  "catering.min_lead_time_hours",
  "catering.payment_deadline_hours",
  "catering.quote_valid_days",
  "catering.delivery_offered",
  "catering.delivery_zip_codes",
  "catering.delivery_fee_cents",
  "catering.delivery_fee_taxable",
  "catering.gratuity_taxable",
  "catering.admin_notification_email",
  "catering.refund_policy",
  "loyalty.catering_earns_points",
  "tax.get_rate",
] as const;

const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

export const DEFAULT_REFUND_POLICY =
  "Cancel free of charge any time before you pay. After payment, ask us to cancel and we'll be in touch about a full or partial refund.";

export async function getCateringSettings(): Promise<CateringSettings> {
  const { data, error } = await createAdminClient().from("settings").select("key, value").in("key", [...KEYS]);
  if (error) throw new Error(`Catering: could not load settings (${error.message})`);
  const get = (key: (typeof KEYS)[number]) => data?.find((row) => row.key === key)?.value;

  const zips = get("catering.delivery_zip_codes");
  const email = get("catering.admin_notification_email");
  const policy = get("catering.refund_policy");

  return {
    minLeadTimeHours: num(get("catering.min_lead_time_hours"), SETTING_FALLBACKS.cateringMinLeadTimeHours),
    paymentDeadlineHours: num(get("catering.payment_deadline_hours"), 48),
    quoteValidDays: num(get("catering.quote_valid_days"), 7),
    deliveryOffered: bool(get("catering.delivery_offered"), true),
    deliveryZipCodes: Array.isArray(zips) ? zips.filter((z): z is string => typeof z === "string") : [],
    deliveryFeeCents: num(get("catering.delivery_fee_cents"), 2500),
    deliveryFeeTaxable: bool(get("catering.delivery_fee_taxable"), true),
    gratuityTaxable: bool(get("catering.gratuity_taxable"), false),
    taxRate: num(get("tax.get_rate"), SETTING_FALLBACKS.getRate),
    adminNotificationEmail: typeof email === "string" && email.includes("@") ? email : null,
    refundPolicy: typeof policy === "string" && policy.trim() ? policy : DEFAULT_REFUND_POLICY,
    cateringEarnsPoints: bool(get("loyalty.catering_earns_points"), false),
  };
}

/**
 * Promo codes for the admin: status, the form's shape and its checks.
 * Pure; the database checks again (admin_save_promo) and locks a redeemed
 * code's code and discount (DC040).
 */
import { formatCents } from "@/lib/money";

export type PromoStatus = "inactive" | "used_up" | "expired" | "scheduled" | "active";

export const PROMO_STATUS_LABEL: Record<PromoStatus, string> = {
  active: "Active",
  scheduled: "Scheduled",
  expired: "Expired",
  used_up: "Used up",
  inactive: "Switched off",
};

export interface AdminPromo {
  id: string;
  code: string;
  description: string | null;
  type: "percent" | "fixed";
  percent: number | null;
  amountCents: number | null;
  minSpendCents: number;
  maxDiscountCents: number | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  timesUsed: number;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  discountGivenCents: number;
  redemptions: number;
}

export function promoStatus(promo: Pick<AdminPromo, "isActive" | "usageLimit" | "timesUsed" | "startsAt" | "endsAt">, now: Date): PromoStatus {
  if (!promo.isActive) return "inactive";
  if (promo.usageLimit !== null && promo.timesUsed >= promo.usageLimit) return "used_up";
  if (promo.endsAt && Date.parse(promo.endsAt) <= now.getTime()) return "expired";
  if (Date.parse(promo.startsAt) > now.getTime()) return "scheduled";
  return "active";
}

export function promoValue(promo: Pick<AdminPromo, "type" | "percent" | "amountCents" | "maxDiscountCents">): string {
  if (promo.type === "percent") return `${promo.percent}% off${promo.maxDiscountCents ? ` (up to ${formatCents(promo.maxDiscountCents)})` : ""}`;
  return `${formatCents(promo.amountCents ?? 0)} off`;
}

export interface PromoForm {
  id: string | null;
  code: string;
  description: string;
  type: "percent" | "fixed";
  percent: string;
  amount: string;
  minSpend: string;
  maxDiscount: string;
  usageLimit: string;
  perUserLimit: string;
  /** ISO instants (Honolulu wall clock converted by the form). */
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

const dollars = (text: string) => (/^\d{1,5}(\.\d{1,2})?$/.test(text.trim()) ? Math.round(Number(text) * 100) : null);
const whole = (text: string) => (/^\d{1,7}$/.test(text.trim()) ? Number(text) : null);

export function validatePromo(form: PromoForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^[A-Z0-9][A-Z0-9-]{2,29}$/.test(form.code.trim().toUpperCase())) errors.code = "3 to 30 letters, numbers or hyphens.";
  if (form.type === "percent") {
    const p = Number(form.percent);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(form.percent.trim()) || p <= 0 || p > 100) errors.percent = "A percentage from 0.01 to 100.";
    if (form.maxDiscount.trim() && !dollars(form.maxDiscount)) errors.maxDiscount = "An amount like 10.00, or blank for no cap.";
  } else {
    const a = dollars(form.amount);
    if (!a || a > 100_000) errors.amount = "An amount like 5.00.";
  }
  if (form.minSpend.trim() && dollars(form.minSpend) === null) errors.minSpend = "An amount like 15.00, or blank.";
  if (form.usageLimit.trim() && !whole(form.usageLimit)) errors.usageLimit = "A whole number, or blank for no limit.";
  if (form.perUserLimit.trim() && (!whole(form.perUserLimit) || Number(form.perUserLimit) > 1000)) errors.perUserLimit = "A whole number up to 1,000, or blank.";
  if (form.endsAt && form.startsAt && Date.parse(form.endsAt) <= Date.parse(form.startsAt)) errors.endsAt = "The end must be after the start.";
  if (form.description.length > 200) errors.description = "Up to 200 characters.";
  return errors;
}

export function promoFormToRpc(form: PromoForm) {
  return {
    id: form.id,
    code: form.code.trim().toUpperCase(),
    description: form.description.trim(),
    type: form.type,
    percent: form.type === "percent" ? form.percent.trim() : "",
    amount_cents: form.type === "fixed" ? dollars(form.amount) : null,
    min_spend_cents: form.minSpend.trim() ? dollars(form.minSpend) : 0,
    max_discount_cents: form.type === "percent" && form.maxDiscount.trim() ? dollars(form.maxDiscount) : null,
    usage_limit: form.usageLimit.trim() ? whole(form.usageLimit) : null,
    per_user_limit: form.perUserLimit.trim() ? whole(form.perUserLimit) : null,
    starts_at: form.startsAt ?? "",
    ends_at: form.endsAt ?? "",
    is_active: form.isActive,
  };
}

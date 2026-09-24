import "server-only";

/**
 * Business settings checkout depends on, read fresh (an admin edit to the
 * GET rate must apply to the very next order), with the brand fallbacks only
 * if a row is missing.
 */
import { SETTING_FALLBACKS } from "@/lib/brand";
import type { PickupSettings } from "@/lib/checkout/pickup";
import type { TipPolicy } from "@/lib/pricing";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CheckoutSettings {
  taxRate: number;
  tipPolicy: TipPolicy;
  defaultTipPercent: number;
  pickup: PickupSettings;
  pendingExpiryMinutes: number;
  onlineOrderingEnabled: boolean;
  pickupInstructions: string | null;
}

const KEYS = [
  "tax.get_rate",
  "tip.presets",
  "tip.default_preset",
  "tip.custom_max_cents",
  "tip.custom_max_percent",
  "orders.scheduling_slot_minutes",
  "orders.last_slot_buffer_minutes",
  "orders.max_orders_per_slot",
  "orders.queue_minutes_per_order",
  "orders.pending_expiry_minutes",
  "orders.accepting_online_orders",
  "store.pickup_instructions",
] as const;

const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export async function getCheckoutSettings(): Promise<CheckoutSettings> {
  const { data, error } = await createAdminClient().from("settings").select("key, value").in("key", [...KEYS]);
  if (error) throw new Error(`Checkout: could not load settings (${error.message})`);

  const get = (key: (typeof KEYS)[number]) => data?.find((row) => row.key === key)?.value;
  const presets = get("tip.presets");

  return {
    taxRate: num(get("tax.get_rate"), SETTING_FALLBACKS.getRate),
    tipPolicy: {
      presetPercents:
        Array.isArray(presets) && presets.every((p) => typeof p === "number")
          ? (presets as number[])
          : [...SETTING_FALLBACKS.tipPresets],
      customMaxCents: num(get("tip.custom_max_cents"), 10_000),
      customMaxPercentOfSubtotal: num(get("tip.custom_max_percent"), 100),
    },
    defaultTipPercent: num(get("tip.default_preset"), SETTING_FALLBACKS.defaultTipPreset),
    pickup: {
      slotMinutes: num(get("orders.scheduling_slot_minutes"), SETTING_FALLBACKS.schedulingSlotMinutes),
      lastSlotBufferMinutes: num(get("orders.last_slot_buffer_minutes"), 15),
      maxOrdersPerSlot: num(get("orders.max_orders_per_slot"), 0) || null,
      queueMinutesPerOrder: num(get("orders.queue_minutes_per_order"), 2),
    },
    pendingExpiryMinutes: num(get("orders.pending_expiry_minutes"), 30),
    onlineOrderingEnabled: get("orders.accepting_online_orders") !== false,
    pickupInstructions: typeof get("store.pickup_instructions") === "string" ? (get("store.pickup_instructions") as string) : null,
  };
}

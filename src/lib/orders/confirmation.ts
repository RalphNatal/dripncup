import "server-only";

/**
 * What the confirmation page shows, for the order's owner only. Read with
 * the customer's own session (RLS) and then checked against their id, so
 * staff -- who can read orders at their location -- still cannot open a
 * customer's confirmation page.
 */
import { z } from "zod";

import { getCurrentProfile } from "@/lib/auth/dal";
import type { OrderStatus } from "@/lib/order-status";
import { createClient } from "@/lib/supabase/server";

export interface OrderConfirmation {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  cancellationReason: string | null;
  pickupType: "asap" | "scheduled";
  scheduledFor: string | null;
  estimatedReadyAt: string | null;
  location: { name: string; addressLines: string[]; pickupInstructions: string | null };
  cupName: string | null;
  items: {
    name: string;
    sizeName: string | null;
    options: string[];
    quantity: number;
    lineTotalCents: number;
    specialInstructions: string | null;
  }[];
  totals: {
    subtotalCents: number;
    discountCents: number;
    promoCode: string | null;
    taxCents: number;
    taxRate: number;
    tipCents: number;
    totalCents: number;
  };
  payment: { status: string; failureMessage: string | null; refundedCents: number } | null;
}

type SnapshotModifier = { option_name?: string; quantity?: number; quantity_unit?: string | null };

function describeSnapshot(modifier: SnapshotModifier): string {
  const name = modifier.option_name ?? "";
  const quantity = modifier.quantity ?? 1;
  if (quantity <= 1) return name;
  return modifier.quantity_unit ? `${name} (${quantity} ${modifier.quantity_unit}s)` : `${name} × ${quantity}`;
}

export async function getOrderConfirmation(orderId: string): Promise<OrderConfirmation | null> {
  if (!z.guid().safeParse(orderId).success) return null;
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, user_id, order_number, status, cancellation_reason, pickup_type, scheduled_for, estimated_ready_at,
       customer_first_name, subtotal_cents, discount_cents, promo_code, tax_cents, tax_rate, tip_cents, total_cents,
       locations(name, address_line1, address_line2, city, state, postal_code, pickup_instructions),
       order_items(product_name, size_name, modifiers, quantity, line_total_cents, special_instructions, created_at),
       payments(status, failure_message, refunded_cents, created_at)`,
    )
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.user_id !== profile.id) return null;

  const location = order.locations;
  const cityLine = location
    ? [location.city, [location.state, location.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : "";
  const payment = [...(order.payments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];

  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    cancellationReason: order.cancellation_reason,
    pickupType: order.pickup_type,
    scheduledFor: order.scheduled_for,
    estimatedReadyAt: order.estimated_ready_at,
    location: {
      name: location?.name ?? "Drincup Cafe",
      addressLines: location ? [location.address_line1, location.address_line2, cityLine].filter((l): l is string => Boolean(l)) : [],
      pickupInstructions: location?.pickup_instructions ?? null,
    },
    cupName: order.customer_first_name,
    items: [...(order.order_items ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((item) => ({
        name: item.product_name,
        sizeName: item.size_name,
        options: Array.isArray(item.modifiers) ? (item.modifiers as SnapshotModifier[]).map(describeSnapshot) : [],
        quantity: item.quantity,
        lineTotalCents: item.line_total_cents,
        specialInstructions: item.special_instructions,
      })),
    totals: {
      subtotalCents: order.subtotal_cents,
      discountCents: order.discount_cents,
      promoCode: order.promo_code,
      taxCents: order.tax_cents,
      taxRate: Number(order.tax_rate),
      tipCents: order.tip_cents,
      totalCents: order.total_cents,
    },
    payment: payment
      ? { status: payment.status, failureMessage: payment.failure_message, refundedCents: payment.refunded_cents }
      : null,
  };
}

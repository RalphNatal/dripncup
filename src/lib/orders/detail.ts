/**
 * One order as the customer sees it: the confirmation page, the live tracker
 * and the emails all read this shape.
 *
 * Isomorphic on purpose. The server renders the first view with its own
 * client; the tracker refetches in the browser with the customer's session
 * (RLS limits it to their own orders); the email sender reads with the
 * service role. All three run the same select through the same mapper, so
 * they can never disagree about what an order says.
 */
import type { OrderStatus } from "@/lib/order-status";
import { describeModifier } from "@/lib/pricing";

/** The `order_items.modifiers` snapshot entry, as checkout writes it. */
export interface SnapshotModifier {
  group_id?: string;
  group_name?: string;
  option_id?: string;
  option_name?: string;
  quantity?: number;
  price_delta_cents?: number;
  charge_per_quantity?: boolean;
  quantity_unit?: string | null;
}

export interface OrderDetailItem {
  id: string;
  productId: string | null;
  productSizeId: string | null;
  name: string;
  sizeName: string | null;
  /** "Oat milk", "Vanilla (2 pumps)". */
  options: string[];
  modifiers: SnapshotModifier[];
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  specialInstructions: string | null;
}

export interface PaymentMethod {
  brand: string | null;
  last4: string | null;
  wallet: string | null;
}

export interface OrderDetail {
  id: string;
  userId: string | null;
  orderNumber: string;
  status: OrderStatus;
  cancellationReason: string | null;
  pickupType: "asap" | "scheduled";
  scheduledFor: string | null;
  estimatedReadyAt: string | null;
  createdAt: string;
  /** When each step happened; null until it has. */
  times: {
    placed: string | null;
    accepted: string | null;
    preparing: string | null;
    ready: string | null;
    pickedUp: string | null;
    cancelled: string | null;
    refunded: string | null;
  };
  location: {
    id: string;
    name: string;
    addressLines: string[];
    /** For map links. */
    addressOneLine: string;
    pickupInstructions: string | null;
  };
  cupName: string | null;
  items: OrderDetailItem[];
  totals: {
    subtotalCents: number;
    discountCents: number;
    promoCode: string | null;
    taxCents: number;
    taxRate: number;
    tipCents: number;
    totalCents: number;
  };
  payment: {
    status: string;
    amountCents: number;
    failureMessage: string | null;
    refundedCents: number;
    method: PaymentMethod | null;
  } | null;
}

/** The PostgREST select every reader uses. */
export const ORDER_DETAIL_SELECT = `
  id, user_id, order_number, status, cancellation_reason, pickup_type, scheduled_for, estimated_ready_at,
  created_at, placed_at, accepted_at, preparing_at, ready_at, picked_up_at, cancelled_at,
  customer_first_name, subtotal_cents, discount_cents, promo_code, tax_cents, tax_rate, tip_cents, total_cents,
  location_id,
  locations(id, name, address_line1, address_line2, city, state, postal_code, pickup_instructions),
  order_items(id, product_id, product_size_id, product_name, size_name, modifiers, quantity, unit_price_cents,
              line_total_cents, special_instructions, created_at),
  payments(status, amount_cents, failure_message, refunded_cents, method_brand, method_last4, method_wallet, created_at),
  order_status_history(to_status, created_at)
`;

/** The row ORDER_DETAIL_SELECT returns. Loose on purpose: three different clients read it. */
export interface OrderDetailRow {
  id: string;
  user_id: string | null;
  order_number: string;
  status: OrderStatus;
  cancellation_reason: string | null;
  pickup_type: "asap" | "scheduled";
  scheduled_for: string | null;
  estimated_ready_at: string | null;
  created_at: string;
  placed_at: string | null;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  cancelled_at: string | null;
  customer_first_name: string | null;
  subtotal_cents: number;
  discount_cents: number;
  promo_code: string | null;
  tax_cents: number;
  tax_rate: number | string;
  tip_cents: number;
  total_cents: number;
  location_id: string;
  locations: {
    id: string;
    name: string;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    pickup_instructions: string | null;
  } | null;
  order_items:
    | {
        id: string;
        product_id: string | null;
        product_size_id: string | null;
        product_name: string;
        size_name: string | null;
        modifiers: unknown;
        quantity: number;
        unit_price_cents: number;
        line_total_cents: number;
        special_instructions: string | null;
        created_at: string;
      }[]
    | null;
  payments:
    | {
        status: string;
        amount_cents: number;
        failure_message: string | null;
        refunded_cents: number;
        method_brand: string | null;
        method_last4: string | null;
        method_wallet: string | null;
        created_at: string;
      }[]
    | null;
  order_status_history: { to_status: OrderStatus; created_at: string }[] | null;
}

function snapshotModifiers(value: unknown): SnapshotModifier[] {
  return Array.isArray(value) ? (value.filter((m) => m && typeof m === "object") as SnapshotModifier[]) : [];
}

/** "Vanilla (2 pumps)", read from a snapshot entry. */
export function describeSnapshotModifier(modifier: SnapshotModifier): string {
  return describeModifier({
    groupId: modifier.group_id ?? "",
    groupName: modifier.group_name ?? "",
    optionId: modifier.option_id ?? "",
    optionName: modifier.option_name ?? "",
    quantity: modifier.quantity ?? 1,
    priceDeltaCents: modifier.price_delta_cents ?? 0,
    chargePerQuantity: modifier.charge_per_quantity ?? false,
    quantityUnit: modifier.quantity_unit ?? null,
  });
}

const latestFirst = <T extends { created_at: string }>(rows: readonly T[] | null) =>
  [...(rows ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));

export function toOrderDetail(row: OrderDetailRow): OrderDetail {
  const location = row.locations;
  const cityLine = location
    ? [location.city, [location.state, location.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : "";
  const addressLines = location
    ? [location.address_line1, location.address_line2, cityLine].filter((l): l is string => Boolean(l))
    : [];
  const payment = latestFirst(row.payments)[0];
  const refundedAt = latestFirst(row.order_status_history).find((h) => h.to_status === "refunded")?.created_at ?? null;

  return {
    id: row.id,
    userId: row.user_id,
    orderNumber: row.order_number,
    status: row.status,
    cancellationReason: row.cancellation_reason,
    pickupType: row.pickup_type,
    scheduledFor: row.scheduled_for,
    estimatedReadyAt: row.estimated_ready_at,
    createdAt: row.created_at,
    times: {
      placed: row.placed_at,
      accepted: row.accepted_at,
      preparing: row.preparing_at,
      ready: row.ready_at,
      pickedUp: row.picked_up_at,
      cancelled: row.cancelled_at,
      refunded: refundedAt,
    },
    location: {
      id: location?.id ?? row.location_id,
      name: location?.name ?? "Drincup Cafe",
      addressLines,
      addressOneLine: addressLines.join(", "),
      pickupInstructions: location?.pickup_instructions ?? null,
    },
    cupName: row.customer_first_name,
    items: [...(row.order_items ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((item) => {
        const modifiers = snapshotModifiers(item.modifiers);
        return {
          id: item.id,
          productId: item.product_id,
          productSizeId: item.product_size_id,
          name: item.product_name,
          sizeName: item.size_name,
          options: modifiers.map(describeSnapshotModifier),
          modifiers,
          quantity: item.quantity,
          unitPriceCents: item.unit_price_cents,
          lineTotalCents: item.line_total_cents,
          specialInstructions: item.special_instructions,
        };
      }),
    totals: {
      subtotalCents: row.subtotal_cents,
      discountCents: row.discount_cents,
      promoCode: row.promo_code,
      taxCents: row.tax_cents,
      taxRate: Number(row.tax_rate),
      tipCents: row.tip_cents,
      totalCents: row.total_cents,
    },
    payment: payment
      ? {
          status: payment.status,
          amountCents: payment.amount_cents,
          failureMessage: payment.failure_message,
          refundedCents: payment.refunded_cents,
          method:
            payment.method_brand || payment.method_last4 || payment.method_wallet
              ? { brand: payment.method_brand, last4: payment.method_last4, wallet: payment.method_wallet }
              : null,
        }
      : null,
  };
}

const BRAND_NAMES: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  jcb: "JCB",
  diners: "Diners Club",
  unionpay: "UnionPay",
};

const WALLET_NAMES: Record<string, string> = {
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  link: "Link",
  samsung_pay: "Samsung Pay",
};

/** "Visa •••• 4242", "Apple Pay · Visa •••• 4242", "Link". Null when nothing is known. */
export function paymentMethodLabel(method: PaymentMethod | null): string | null {
  if (!method) return null;
  const brand = method.brand ? (BRAND_NAMES[method.brand] ?? method.brand.replace(/^\w/, (c) => c.toUpperCase())) : null;
  const card = brand ? (method.last4 ? `${brand} •••• ${method.last4}` : brand) : method.last4 ? `Card •••• ${method.last4}` : null;
  const wallet = method.wallet ? (WALLET_NAMES[method.wallet] ?? method.wallet.replace(/_/g, " ")) : null;
  if (wallet && card) return `${wallet} · ${card}`;
  return wallet ?? card;
}

/** "Latte", "2 × Latte", "Latte + 2 more" -- quantities count, so two lattes and a cookie is "2 × Latte + 1 more". */
export function itemSummary(items: readonly { name: string; quantity: number }[]): string {
  if (items.length === 0) return "No items";
  const [first, ...rest] = items;
  const head = first.quantity > 1 ? `${first.quantity} × ${first.name}` : first.name;
  const more = rest.reduce((sum, item) => sum + item.quantity, 0);
  return more > 0 ? `${head} + ${more} more` : head;
}

/** Engine modifiers → the snapshot shape order items and favourites store. */
export function snapshotFromSelected(
  modifiers: readonly {
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    quantity: number;
    priceDeltaCents: number;
    chargePerQuantity: boolean;
    quantityUnit: string | null;
  }[],
): SnapshotModifier[] {
  return modifiers.map((m) => ({
    group_id: m.groupId,
    group_name: m.groupName,
    option_id: m.optionId,
    option_name: m.optionName,
    quantity: m.quantity,
    price_delta_cents: m.priceDeltaCents,
    charge_per_quantity: m.chargePerQuantity,
    quantity_unit: m.quantityUnit,
  }));
}

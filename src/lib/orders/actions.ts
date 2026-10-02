"use server";

/**
 * Server Actions for the customer's orders: "Order again" and the history's
 * "Load more". Each re-checks who is calling; orders are read with the
 * customer's own session.
 */
import { getCurrentProfile } from "@/lib/auth/dal";

import { getOwnOrderDetail, listPastOrders, type PastOrdersPage } from "./queries";
import { reorderLocation, type ReorderReview } from "./reorder";
import { loadReviewContext } from "./review-context";

/**
 * A past order rebuilt against today's menu at the selected location: what can
 * be added at current prices, what changed price, what is unavailable and why.
 * Nothing is added here; the browser shows the review first.
 */
export async function reviewReorderAction(orderId: unknown): Promise<ReorderReview | { error: string }> {
  if (typeof orderId !== "string") return { error: "Order not found." };
  const order = await getOwnOrderDetail(orderId);
  if (!order) return { error: "Order not found." };
  const context = await loadReviewContext();
  if (!context) return { error: "Ordering isn't set up yet." };

  const { location } = context;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    lines: order.items.map((item) =>
      context.review({
        key: item.id,
        productId: item.productId,
        productName: item.name,
        sizeId: item.productSizeId,
        sizeName: item.sizeName,
        modifiers: item.modifiers,
        quantity: item.quantity,
        specialInstructions: item.specialInstructions,
        previousUnitPriceCents: item.unitPriceCents,
      }),
    ),
    location: reorderLocation(
      { id: order.location.id, name: order.location.name },
      { id: location.id, name: location.name },
      context.offered.map((l) => l.id),
    ),
    ordering: { canOrder: location.status.canOrder, reason: location.status.unavailableReason },
  };
}

export async function loadMorePastOrdersAction(cursor: unknown): Promise<PastOrdersPage | { error: string }> {
  if (typeof cursor !== "string" || cursor.length > 120) return { error: "Couldn't load more orders." };
  if (!(await getCurrentProfile())) return { error: "Sign in to see your orders." };
  return listPastOrders(cursor);
}

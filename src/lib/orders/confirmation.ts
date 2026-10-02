import "server-only";

/**
 * What the confirmation page shows, for the order's owner only: the same
 * order detail the tracker reads (see ./detail.ts).
 */
import type { OrderDetail } from "./detail";
import { getOwnOrderDetail } from "./queries";

export type OrderConfirmation = OrderDetail;

export async function getOrderConfirmation(orderId: string): Promise<OrderConfirmation | null> {
  return getOwnOrderDetail(orderId);
}

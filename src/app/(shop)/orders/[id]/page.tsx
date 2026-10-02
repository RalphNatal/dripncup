import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { OrderTracker } from "@/components/orders/order-tracker";
import { requireProfile } from "@/lib/auth/dal";
import { getOwnOrderDetail } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Your order" };

type Params = Promise<{ id: string }>;

/**
 * The live order tracker. Only the order's owner can open it; anyone else --
 * other customers, and staff who can read the order for the queue -- gets a
 * 404, not a hint that the order exists. An order still waiting for payment
 * belongs on the confirmation page, which can take the payment.
 */
export default async function OrderPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireProfile(`/orders/${id}`);
  const order = await getOwnOrderDetail(id);
  if (!order) notFound();
  if (order.status === "pending_payment") redirect(`/orders/${order.id}/confirmed`);

  return (
    <div className="mx-auto max-w-xl">
      <OrderTracker initial={order} />
    </div>
  );
}

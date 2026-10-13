import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth/dal";
import { getOwnOrderDetail } from "@/lib/orders/queries";

/**
 * Someone else's order (or none) is a real 404; a guest gets a real redirect
 * to sign in, and an unpaid order a real redirect to its confirmation page.
 *
 * The check runs here, above the page's loading skeleton (route groups keep
 * the parent pages' skeletons off this route): once a skeleton has streamed
 * the status is already 200, and the not-found page could only arrive inside
 * it. The page reads the same row again from the per-request cache.
 */
export default async function OrderTrackerLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile(`/orders/${id}`);
  const order = await getOwnOrderDetail(id);
  if (!order) notFound();
  if (order.status === "pending_payment") redirect(`/orders/${order.id}/confirmed`);
  return children;
}

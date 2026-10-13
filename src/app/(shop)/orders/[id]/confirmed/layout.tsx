import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth/dal";
import { getOrderConfirmation } from "@/lib/orders/confirmation";

/**
 * Someone else's order (or none) is a real 404, and a guest gets a real
 * redirect to sign in.
 *
 * The check runs here, above the page's loading skeleton (route groups keep
 * the parent pages' skeletons off this route): once a skeleton has streamed
 * the status is already 200, and the not-found page could only arrive inside
 * it. The page reads the same row again from the per-request cache.
 */
export default async function OrderConfirmedLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireProfile(`/orders/${id}/confirmed`);
  if (!(await getOrderConfirmation(id))) notFound();
  return children;
}

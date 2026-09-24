import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConfirmationView } from "@/components/checkout/confirmation-view";
import { requireProfile } from "@/lib/auth/dal";
import { clientEnv } from "@/lib/env";
import { getOrderConfirmation } from "@/lib/orders/confirmation";

export const metadata: Metadata = { title: "Order confirmation" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Where Stripe sends the customer back after paying (return_url), including
 * after a 3-D Secure challenge or a redirect-based payment method. Only the
 * order's owner can open it; anyone else gets a 404, not a hint that the
 * order exists.
 */
export default async function OrderConfirmedPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { id } = await params;
  await requireProfile(`/orders/${id}/confirmed`);
  const order = await getOrderConfirmation(id);
  if (!order) notFound();

  const redirectStatus = (await searchParams).redirect_status;

  return (
    <div className="mx-auto max-w-xl">
      <ConfirmationView
        initial={order}
        redirectStatus={typeof redirectStatus === "string" ? redirectStatus : null}
        publishableKey={clientEnv.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null}
      />
    </div>
  );
}

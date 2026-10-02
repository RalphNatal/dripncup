import { CupSoda } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { ActiveOrderCards, PastOrdersList } from "@/components/orders/order-lists";
import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";
import { listActiveOrders, listPastOrders } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Orders" };

/**
 * Order history: what is on its way now (live), then past orders, newest
 * first, ten at a time. Only orders that were paid for appear; an abandoned
 * checkout is not history.
 */
export default async function OrdersPage() {
  const profile = await requireProfile("/orders");
  const [active, past] = await Promise.all([listActiveOrders(), listPastOrders()]);

  if (active.length === 0 && past.orders.length === 0) {
    return (
      <PageShell title="Orders">
        <EmptyState
          icon={CupSoda}
          title="No orders yet"
          action={
            <Link
              href="/menu"
              className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
            >
              Browse the menu
            </Link>
          }
        >
          Your orders and their progress will show up here.
        </EmptyState>
      </PageShell>
    );
  }

  return (
    <PageShell title="Orders">
      <div className="space-y-8">
        <ActiveOrderCards userId={profile.id} initial={active} heading="Active" />

        <section aria-labelledby="past-orders-heading">
          <h2 id="past-orders-heading" className="mb-2 text-lg font-bold">
            Past
          </h2>
          {past.orders.length > 0 ? (
            <PastOrdersList initial={past} />
          ) : (
            <p className="text-sm text-muted-foreground">Finished orders will be listed here.</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}

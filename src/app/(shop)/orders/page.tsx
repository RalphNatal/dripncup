import { Receipt } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Orders" };

/** Placeholder: order tracking and history arrive in Phase 5. */
export default async function OrdersPage() {
  await requireProfile("/orders");

  return (
    <PageShell title="Orders">
      <div className="rounded-3xl border bg-card p-6 text-center">
        <Receipt className="mx-auto size-10 text-brand-teal-deep" aria-hidden="true" />
        <p className="mt-3 text-lg font-bold">No orders yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your orders and their progress will show up here.
        </p>
        <Link
          href="/menu"
          className="focus-ring mt-5 inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
        >
          Browse the menu
        </Link>
      </div>
    </PageShell>
  );
}

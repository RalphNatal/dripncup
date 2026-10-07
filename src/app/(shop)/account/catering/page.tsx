import { ChefHat, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CateringStatusBadge } from "@/components/catering/status-badge";
import { EmptyState } from "@/components/empty-state";
import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";
import { eventWhen } from "@/lib/catering/format";
import { listMyCateringRequests } from "@/lib/catering/queries";
import { formatCents } from "@/lib/money";

export const metadata: Metadata = { title: "My catering" };

export default async function MyCateringPage() {
  const profile = await requireProfile("/account/catering");
  const requests = await listMyCateringRequests(profile.id);

  return (
    <PageShell title="My catering" backHref="/account" backLabel="Account">
      {requests.length === 0 ? (
        <EmptyState
          icon={ChefHat}
          title="No catering requests yet"
          action={
            <Link href="/catering" className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 font-semibold text-white">
              Plan an event
            </Link>
          }
        >
          Office mornings, parties, launches: tell us about your event and we&apos;ll send a quote.
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-3" data-testid="my-catering">
            {requests.map((request) => (
              <li key={request.id}>
                <Link
                  href={`/account/catering/${request.id}`}
                  className="focus-ring flex items-center gap-3 rounded-3xl border bg-card p-4 hover:border-brand-teal-deep"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="tabular font-bold">{request.requestNumber}</span>
                      <CateringStatusBadge status={request.status} />
                    </p>
                    <p className="mt-1 text-sm">{eventWhen(request.eventAt)}</p>
                    <p className="text-sm text-muted-foreground">
                      {request.headcount} guests · {request.fulfillment === "delivery" ? "Delivery" : "Pickup"}
                      {request.totalCents !== null ? ` · ${formatCents(request.totalCents)}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-center text-sm">
            <Link href="/catering" className="focus-ring rounded font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
              Request catering for another event
            </Link>
          </p>
        </>
      )}
    </PageShell>
  );
}

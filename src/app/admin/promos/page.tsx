import { Plus } from "lucide-react";
import type { Metadata } from "next";

import { DataTable } from "@/components/admin/data-table";
import { AdminButtonLink, AdminPageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { PROMO_STATUS_LABEL, promoStatus, promoValue, type AdminPromo } from "@/lib/promos/admin";
import { listAdminPromos } from "@/lib/promos/admin-queries";
import { formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Promotions · Admin" };

const TONE = { active: "good", scheduled: "info", expired: "neutral", used_up: "neutral", inactive: "warn" } as const;

export default async function PromosPage() {
  await requireRole(["admin"], "/admin/promos");
  const [promos, now] = await Promise.all([listAdminPromos(), appNow()]);

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="Promotions"
        description="Promo codes customers type at checkout. One code per order; codes ignore capitals."
        actions={
          <AdminButtonLink href="/admin/promos/new">
            <Plus className="size-4" aria-hidden="true" />
            New code
          </AdminButtonLink>
        }
      />
      <DataTable<AdminPromo>
        caption="Promo codes"
        rows={promos}
        rowKey={(p) => p.id}
        rowHref={(p) => `/admin/promos/${p.id}`}
        empty="No promo codes yet."
        columns={[
          { header: "Code", primary: true, cell: (p) => <span className="font-mono">{p.code}</span> },
          { header: "Discount", cell: promoValue },
          {
            header: "Status",
            cell: (p) => {
              const status = promoStatus(p, now);
              return <StatusPill tone={TONE[status]}>{PROMO_STATUS_LABEL[status]}</StatusPill>;
            },
          },
          { header: "Uses", cell: (p) => `${p.timesUsed}${p.usageLimit ? ` of ${p.usageLimit}` : ""}`, className: "text-right tabular" },
          { header: "Discount given", cell: (p) => formatCents(p.discountGivenCents), className: "text-right tabular" },
          { header: "Ends", cell: (p) => (p.endsAt ? formatCafeDateTime(new Date(p.endsAt)) : "No end") },
        ]}
      />
    </div>
  );
}

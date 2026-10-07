import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DataTable } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PromoForm } from "@/components/admin/promo-form";
import { StatusPill } from "@/components/admin/status-pill";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { PROMO_STATUS_LABEL, promoStatus, promoValue } from "@/lib/promos/admin";
import { listAdminPromos, listPromoRedemptions } from "@/lib/promos/admin-queries";
import { formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Promo · Admin" };

type Params = Promise<{ id: string }>;

const input = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export default async function PromoPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/promos/${id}`);
  if (!isUuid(id)) notFound();
  const [promos, now] = await Promise.all([listAdminPromos(), appNow()]);
  const promo = promos.find((p) => p.id === id);
  if (!promo) notFound();
  const redemptions = await listPromoRedemptions(id);
  const locked = promo.timesUsed > 0 || redemptions.length > 0;
  const status = promoStatus(promo, now);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        backHref="/admin/promos"
        backLabel="Promotions"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="font-mono">{promo.code}</span>
            <StatusPill tone={status === "active" ? "good" : "neutral"}>{PROMO_STATUS_LABEL[status]}</StatusPill>
          </span>
        }
        description={`${promoValue(promo)} · used ${promo.timesUsed} time${promo.timesUsed === 1 ? "" : "s"} · ${formatCents(promo.discountGivenCents)} given`}
      />
      <PromoForm
        key={JSON.stringify(promo)}
        locked={locked}
        initial={{
          id: promo.id,
          code: promo.code,
          description: promo.description ?? "",
          type: promo.type,
          percent: promo.percent === null ? "" : String(promo.percent),
          amount: input(promo.amountCents),
          minSpend: promo.minSpendCents ? input(promo.minSpendCents) : "",
          maxDiscount: input(promo.maxDiscountCents),
          usageLimit: promo.usageLimit === null ? "" : String(promo.usageLimit),
          perUserLimit: promo.perUserLimit === null ? "" : String(promo.perUserLimit),
          startsAt: promo.startsAt,
          endsAt: promo.endsAt,
          isActive: promo.isActive,
        }}
      />
      <section aria-labelledby="redemptions" className="space-y-3">
        <h2 id="redemptions" className="text-xl font-bold">
          Redemptions
        </h2>
        <DataTable
          caption="Orders that used this code"
          rows={redemptions}
          rowKey={(r) => r.orderId}
          empty="Nobody has used this code yet."
          columns={[
            {
              header: "Order",
              primary: true,
              cell: (r) => (
                <Link href={`/admin/orders/${r.orderId}`} className="font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
                  {r.orderNumber}
                </Link>
              ),
            },
            { header: "Date", cell: (r) => formatCafeDateTime(new Date(r.redeemedAt)) },
            { header: "Customer", cell: (r) => r.customerFirstName ?? "—" },
            { header: "Discount", cell: (r) => formatCents(r.amountCents), className: "text-right tabular" },
          ]}
        />
      </section>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, queryString } from "@/components/admin/data-table";
import { inputClass } from "@/components/admin/form-layout";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { formatCents } from "@/lib/money";
import { ORDER_STATUS_LABEL as STATUS_LABEL, searchOrders, type AdminOrderRow } from "@/lib/orders/admin";
import { listReportLocations } from "@/lib/reports/queries";
import { firstParam, type SearchParams } from "@/lib/search-params";
import { formatCafeDateTime } from "@/lib/time";
import type { Enums } from "@/types/database";

export const metadata: Metadata = { title: "Orders · Admin" };

const STATUSES: Enums<"order_status">[] = ["pending_payment", "placed", "accepted", "preparing", "ready", "picked_up", "cancelled", "refunded"];
const PAYMENTS = { paid: "Paid", partially_refunded: "Partly refunded", refunded: "Refunded", processing: "Processing", failed: "Failed", unpaid: "Unpaid" } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/orders");
  const params = await searchParams;
  const status = firstParam(params.status) as Enums<"order_status"> | undefined;
  const payment = firstParam(params.payment);
  const filters = {
    q: (firstParam(params.q) ?? "").trim().slice(0, 100) || undefined,
    from: DATE.test(firstParam(params.from) ?? "") ? firstParam(params.from) : undefined,
    to: DATE.test(firstParam(params.to) ?? "") ? firstParam(params.to) : undefined,
    locationId: isUuid(firstParam(params.location)) ? firstParam(params.location) : undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    payment: payment && payment in PAYMENTS ? payment : undefined,
    page: Math.max(1, Number(firstParam(params.page)) || 1),
  };
  const [{ rows, total }, locations] = await Promise.all([searchOrders(filters), listReportLocations()]);
  const keep = { from: filters.from, to: filters.to, location: filters.locationId, status: filters.status, payment: filters.payment };

  return (
    <div className="mx-auto max-w-6xl">
      <AdminPageHeader title="Orders" description="Every order, newest first. Dates are Honolulu dates the order was started." />
      <form method="get" className="mb-5 grid gap-3 rounded-3xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter orders">
        <label className="space-y-1 text-sm font-semibold lg:col-span-2">
          Search
          <input type="search" name="q" defaultValue={filters.q} placeholder="Order number, name or email" className={inputClass} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          From
          <input type="date" name="from" defaultValue={filters.from} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          To
          <input type="date" name="to" defaultValue={filters.to} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Location
          <select name="location" defaultValue={filters.locationId ?? ""} className={inputClass}>
            <option value="">All</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Status
          <select name="status" defaultValue={filters.status ?? ""} className={inputClass}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Payment
          <select name="payment" defaultValue={filters.payment ?? ""} className={inputClass}>
            <option value="">Any</option>
            {Object.entries(PAYMENTS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2 lg:col-span-5 lg:justify-end">
          <button type="submit" className="focus-ring min-h-11 rounded-xl bg-brand-teal-deep px-5 text-sm font-semibold text-white">
            Find orders
          </button>
          <Link href="/admin/orders" className="focus-ring inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold hover:bg-muted">
            Clear
          </Link>
        </div>
      </form>
      <DataTable<AdminOrderRow>
        caption="Orders"
        rows={rows}
        rowKey={(o) => o.id}
        rowHref={(o) => `/admin/orders/${o.id}`}
        empty="No orders match."
        pagination={{ page: filters.page, pageSize: 25, total, hrefFor: (p) => `/admin/orders${queryString({ q: filters.q, ...keep, page: p })}` }}
        columns={[
          { header: "Order", primary: true, cell: (o) => <span className="font-mono">{o.orderNumber}</span> },
          { header: "When", cell: (o) => formatCafeDateTime(new Date(o.placedAt ?? o.createdAt)) },
          { header: "Customer", cell: (o) => o.customerName ?? o.customerEmail ?? "—" },
          { header: "Location", cell: (o) => o.locationName },
          {
            header: "Status",
            cell: (o) => (
              <span className="flex flex-wrap gap-1">
                <StatusPill tone={o.status === "cancelled" || o.status === "refunded" ? "neutral" : o.status === "pending_payment" ? "warn" : "good"}>{STATUS_LABEL[o.status]}</StatusPill>
                {o.flagged ? <StatusPill tone="bad">Needs review</StatusPill> : null}
              </span>
            ),
          },
          { header: "Payment", cell: (o) => PAYMENTS[o.paymentState as keyof typeof PAYMENTS] ?? o.paymentState },
          {
            header: "Total",
            className: "text-right tabular",
            cell: (o) => (
              <>
                {formatCents(o.totalCents)}
                {o.refundedCents > 0 ? <span className="block text-xs text-muted-foreground">−{formatCents(o.refundedCents)} refunded</span> : null}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

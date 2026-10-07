import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { queryString } from "@/components/admin/data-table";
import { inputClass } from "@/components/admin/form-layout";
import { InfoTip } from "@/components/admin/info-tip";
import { AdminPageHeader } from "@/components/admin/page-header";
import { InlineBar, PeakHeatmap, SalesColumns } from "@/components/admin/report-charts";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { REPORT_DEFINITIONS, REPORT_PRESETS, activeHours, averageOrderValue, fillDays, parseReportRange, peakGrid, sumSales } from "@/lib/reports/definitions";
import { getCateringRevenue, getDiscountUsage, getPeakHours, getSalesDays, getTopModifiers, getTopProducts, listReportLocations } from "@/lib/reports/queries";
import { firstParam, type SearchParams } from "@/lib/search-params";
import { formatCafeDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports · Admin" };

function Card({ title, definition, actions, children, testId }: { title: string; definition?: string; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section aria-label={title} className="rounded-3xl border bg-card p-5" data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-lg font-bold">
          {title}
          {definition ? <InfoTip label={title}>{definition}</InfoTip> : null}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, definition, hero, testId }: { label: string; value: string; definition: string; hero?: boolean; testId: string }) {
  return (
    <div className={cn("rounded-3xl border bg-card p-4", hero && "col-span-2")} data-testid={testId}>
      <p className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
        {label}
        <InfoTip label={label}>{definition}</InfoTip>
      </p>
      <p className={cn("font-heading font-extrabold", hero ? "text-5xl" : "text-2xl")}>{value}</p>
    </div>
  );
}

function ExportLink({ href, report, label = "CSV" }: { href: string; report: string; label?: string }) {
  return (
    <a href={href} download className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm font-semibold hover:bg-muted" data-testid={`export-${report}`}>
      <Download className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}

const th = "px-3 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase";
const td = "px-3 py-2";

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/reports");
  const params = await searchParams;
  const now = await appNow();
  const { range, problem } = parseReportRange({ preset: firstParam(params.preset), from: firstParam(params.from), to: firstParam(params.to) }, now);
  const location = isUuid(firstParam(params.location)) ? firstParam(params.location)! : null;
  const [days, products, modifiers, peak, discounts, catering, locations] = await Promise.all([
    getSalesDays(range, location),
    getTopProducts(range, location),
    getTopModifiers(range, location),
    getPeakHours(range, location),
    getDiscountUsage(range, location),
    getCateringRevenue(range, location),
    listReportLocations(),
  ]);
  const totals = sumSales(days);
  const filled = fillDays(range, days);
  const { grid, max } = peakGrid(peak);
  const scope = { preset: range.preset, from: range.preset === "custom" ? range.from : undefined, to: range.preset === "custom" ? range.to : undefined, location: location ?? undefined };
  const exportHref = (report: string) => `/admin/reports/export${queryString({ report, from: range.from, to: range.to, location: location ?? undefined })}`;
  const locationName = location ? (locations.find((l) => l.id === location)?.name ?? "One location") : "All locations";
  const cateringTotal = catering.reduce((s, c) => s + c.netCents, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <AdminPageHeader
        title="Reports"
        description={`${formatCafeDate(new Date(`${range.from}T12:00:00-10:00`))} – ${formatCafeDate(new Date(`${range.to}T12:00:00-10:00`))} (Honolulu) · ${locationName}`}
        actions={<ExportLink href={exportHref("orders")} report="orders" label="Orders export (CSV)" />}
      />

      {/* Filters: one row, above everything they scope. */}
      <div className="space-y-3">
        <nav aria-label="Date range" className="flex flex-wrap gap-2">
          {REPORT_PRESETS.filter((p) => p.id !== "custom").map((p) => (
            <Link
              key={p.id}
              href={`/admin/reports${queryString({ preset: p.id, location: location ?? undefined })}`}
              aria-current={range.preset === p.id ? "page" : undefined}
              className={cn("focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold", range.preset === p.id ? "border-brand-teal-deep bg-brand-teal-soft text-brand-teal-deep" : "hover:bg-muted")}
            >
              {p.label}
            </Link>
          ))}
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Custom range and location">
          <input type="hidden" name="preset" value="custom" />
          <label className="space-y-1 text-sm font-semibold">
            From
            <input type="date" name="from" defaultValue={range.from} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-semibold">
            To
            <input type="date" name="to" defaultValue={range.to} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm font-semibold">
            Location or event
            <select name="location" defaultValue={location ?? ""} className={inputClass}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="focus-ring min-h-11 rounded-xl bg-brand-teal-deep px-5 text-sm font-semibold text-white">
            Show
          </button>
        </form>
        {problem ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {problem} Showing the last 7 days.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Counts paid orders by the Honolulu day they were placed. Refunds come off the day of the order they belong to. <InfoTip label="Which orders count">{REPORT_DEFINITIONS.counted} {REPORT_DEFINITIONS.refunds}</InfoTip>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile hero label="Net sales" value={formatCents(totals.netSalesCents)} definition={REPORT_DEFINITIONS.net} testId="report-net-sales" />
        <Tile label="Orders" value={String(totals.orders)} definition={REPORT_DEFINITIONS.orders} testId="report-orders" />
        <Tile label="Average order" value={formatCents(totals.averageOrderValueCents)} definition={REPORT_DEFINITIONS.aov} testId="report-aov" />
        <Tile label="Tax (GET)" value={formatCents(totals.taxCents)} definition={REPORT_DEFINITIONS.tax} testId="report-tax" />
        <Tile label="Tips" value={formatCents(totals.tipCents)} definition={REPORT_DEFINITIONS.tips} testId="report-tips" />
      </div>

      <Card title="Sales by day" definition={`${REPORT_DEFINITIONS.day} ${REPORT_DEFINITIONS.net}`} actions={<ExportLink href={exportHref("sales")} report="sales" />} testId="sales-card">
        {totals.orders === 0 ? <p className="text-sm text-muted-foreground">No paid orders in this range.</p> : <SalesColumns days={filled} />}
        <details className="mt-4" open={filled.length <= 14}>
          <summary className="cursor-pointer text-sm font-semibold text-brand-teal-deep">Table</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm" data-testid="sales-table">
              <caption className="sr-only">Sales by day</caption>
              <thead className="border-b">
                <tr>
                  {["Date", "Orders", "Gross", "Promo", "Reward", "Refunds", "Net sales", "Tax (GET)", "Tips", "Avg order"].map((h) => (
                    <th key={h} scope="col" className={cn(th, h !== "Date" && "text-right")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular divide-y">
                {days.map((d) => (
                  <tr key={d.businessDate}>
                    <th scope="row" className={cn(td, "text-left font-semibold")}>
                      {d.businessDate}
                    </th>
                    {[d.orders, d.grossSalesCents, d.promoDiscountCents, d.rewardDiscountCents, d.refundedCents, d.netSalesCents, d.taxCents, d.tipCents, averageOrderValue(d.netBeforeRefundsCents, d.orders)].map((v, i) => (
                      <td key={i} className={cn(td, "text-right")}>
                        {i === 0 ? v : formatCents(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot className="tabular border-t-2 font-bold">
                <tr data-testid="sales-total-row">
                  <th scope="row" className={cn(td, "text-left")}>
                    Total
                  </th>
                  {[totals.orders, totals.grossSalesCents, totals.promoDiscountCents, totals.rewardDiscountCents, totals.refundedCents, totals.netSalesCents, totals.taxCents, totals.tipCents, totals.averageOrderValueCents].map((v, i) => (
                    <td key={i} className={cn(td, "text-right")}>
                      {i === 0 ? v : formatCents(v)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Top products" definition={REPORT_DEFINITIONS.products} actions={<ExportLink href={exportHref("products")} report="products" />} testId="products-card">
          <RankTable rows={products.map((p) => ({ name: p.name, quantity: p.quantity, revenueCents: p.revenueCents }))} empty="Nothing sold in this range." />
        </Card>
        <Card title="Top add-ons" definition={REPORT_DEFINITIONS.modifiers} actions={<ExportLink href={exportHref("modifiers")} report="modifiers" />} testId="modifiers-card">
          <RankTable rows={modifiers.map((m) => ({ name: m.optionName, detail: m.groupName, quantity: m.quantity, revenueCents: m.revenueCents }))} empty="No add-ons in this range." />
        </Card>
      </div>

      <Card title="Peak hours" definition={REPORT_DEFINITIONS.peak} actions={<ExportLink href={exportHref("peak")} report="peak" />} testId="peak-card">
        {max === 0 ? <p className="text-sm text-muted-foreground">No paid orders in this range.</p> : <PeakHeatmap grid={grid} max={max} hours={activeHours(grid)} />}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Promo and reward usage" definition={REPORT_DEFINITIONS.discounts} actions={<ExportLink href={exportHref("discounts")} report="discounts" />} testId="discounts-card">
          {discounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No promo codes or rewards used.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Promo and reward usage</caption>
              <thead className="border-b">
                <tr>
                  <th scope="col" className={th}>
                    Code or reward
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Uses
                  </th>
                  <th scope="col" className={cn(th, "text-right")}>
                    Discount
                  </th>
                </tr>
              </thead>
              <tbody className="tabular divide-y">
                {discounts.map((d) => (
                  <tr key={`${d.kind}-${d.name}`}>
                    <th scope="row" className={cn(td, "text-left font-semibold")}>
                      {d.kind === "promo" ? <span className="font-mono">{d.name}</span> : d.name}
                      <span className="block text-xs font-normal text-muted-foreground">{d.kind === "promo" ? "Promo code" : `Reward · ${d.points} points`}</span>
                    </th>
                    <td className={cn(td, "text-right")}>{d.uses}</td>
                    <td className={cn(td, "text-right")}>{formatCents(d.discountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Catering revenue" definition={REPORT_DEFINITIONS.catering} actions={<ExportLink href={exportHref("catering")} report="catering" />} testId="catering-card">
          <p className="mb-2 text-sm">
            <span className="font-heading text-2xl font-extrabold">{formatCents(cateringTotal)}</span>{" "}
            <span className="text-muted-foreground">
              kept from {catering.length} paid request{catering.length === 1 ? "" : "s"} (after refunds, tax and gratuity included)
            </span>
          </p>
          {catering.length ? (
            <ul className="divide-y text-sm">
              {catering.map((c) => (
                <li key={c.requestId} className="flex flex-wrap justify-between gap-2 py-2">
                  <Link href={`/admin/catering/${c.requestId}`} className="font-mono font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
                    {c.requestNumber}
                  </Link>
                  <span className="tabular text-muted-foreground">
                    paid {c.paidDate} · {formatCents(c.totalCents)}
                    {c.refundedCents ? ` · −${formatCents(c.refundedCents)} refunded` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>
      <p className="text-xs text-muted-foreground">
        Range: <Link href={`/admin/reports${queryString(scope)}`} className="underline">link to this view</Link>. Definitions are also in ARCHITECTURE.md, “Reports”.
      </p>
    </div>
  );
}

function RankTable({ rows, empty }: { rows: { name: string; detail?: string; quantity: number; revenueCents: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.quantity));
  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr>
          <th scope="col" className={th}>
            Item
          </th>
          <th scope="col" className={cn(th, "text-right")}>
            Sold
          </th>
          <th scope="col" className={cn(th, "text-right")}>
            Revenue
          </th>
        </tr>
      </thead>
      <tbody className="tabular divide-y">
        {rows.map((r) => (
          <tr key={`${r.name}-${r.detail ?? ""}`}>
            <th scope="row" className={cn(td, "text-left font-semibold")}>
              {r.name}
              {r.detail ? <span className="block text-xs font-normal text-muted-foreground">{r.detail}</span> : null}
              <InlineBar value={r.quantity} max={max} />
            </th>
            <td className={cn(td, "text-right")}>{r.quantity}</td>
            <td className={cn(td, "text-right")}>{formatCents(r.revenueCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

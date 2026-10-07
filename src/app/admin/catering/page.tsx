import { CalendarDays, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, queryString } from "@/components/admin/data-table";
import { inputClass } from "@/components/admin/form-layout";
import { AdminPageHeader } from "@/components/admin/page-header";
import { CateringStatusBadge } from "@/components/catering/status-badge";
import { requireRole } from "@/lib/auth/dal";
import { monthGrid, monthOf, rangeOf, shiftMonth, weekKeys, addDaysToKey } from "@/lib/catering/calendar";
import { eventWhen } from "@/lib/catering/format";
import {
  INBOX_PAGE_SIZE,
  listCateringCalendar,
  listCateringInbox,
  type CalendarEntry,
  type CateringRequestSummary,
  type InboxFilters,
} from "@/lib/catering/queries";
import { CATERING_STATUSES, CATERING_STATUS_LABELS } from "@/lib/catering/status";
import { appNow } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { firstParam, type SearchParams } from "@/lib/search-params";
import { cafeDateKey, formatCafeDateLong, formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Catering · Admin" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function tabClass(active: boolean) {
  return cn(
    "focus-ring inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold",
    active ? "bg-brand-teal-deep text-white" : "border hover:bg-muted",
  );
}

export default async function AdminCateringPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/catering");
  const params = await searchParams;
  const view = firstParam(params.view) === "calendar" ? "calendar" : "inbox";

  return (
    <div className="mx-auto max-w-6xl">
      <AdminPageHeader title="Catering" description="Requests, quotes and confirmed events. Newest first; new and changed requests are marked." />
      <nav aria-label="Catering views" className="mb-5 flex gap-2">
        <Link href="/admin/catering" className={tabClass(view === "inbox")} aria-current={view === "inbox" ? "page" : undefined}>
          <Inbox className="size-4" aria-hidden="true" />
          Inbox
        </Link>
        <Link href="/admin/catering?view=calendar" className={tabClass(view === "calendar")} aria-current={view === "calendar" ? "page" : undefined}>
          <CalendarDays className="size-4" aria-hidden="true" />
          Calendar
        </Link>
      </nav>
      {view === "inbox" ? <InboxView params={params} /> : <CalendarView params={params} />}
    </div>
  );
}

async function InboxView({ params }: { params: Awaited<SearchParams> }) {
  const statusParam = firstParam(params.status);
  const fulfillmentParam = firstParam(params.type);
  const filters: InboxFilters = {
    status: statusParam === "new" || (statusParam && (CATERING_STATUSES as string[]).includes(statusParam)) ? (statusParam as InboxFilters["status"]) : "all",
    fulfillment: fulfillmentParam === "pickup" || fulfillmentParam === "delivery" ? fulfillmentParam : "all",
    from: DATE.test(firstParam(params.from) ?? "") ? firstParam(params.from)! : null,
    to: DATE.test(firstParam(params.to) ?? "") ? firstParam(params.to)! : null,
    search: (firstParam(params.q) ?? "").slice(0, 80),
    page: Math.max(1, Number(firstParam(params.page)) || 1),
  };
  const { rows, total } = await listCateringInbox(filters);
  const keep = {
    status: filters.status === "all" ? undefined : filters.status,
    type: filters.fulfillment === "all" ? undefined : filters.fulfillment,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
  };

  return (
    <div className="space-y-4">
      <form method="get" className="grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filter requests">
        {filters.search ? <input type="hidden" name="q" value={filters.search} /> : null}
        <label className="space-y-1 text-sm">
          <span className="block font-semibold">Status</span>
          <select name="status" defaultValue={filters.status} className={inputClass}>
            <option value="all">All</option>
            <option value="new">New / unread</option>
            {CATERING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CATERING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-semibold">Pickup or delivery</span>
          <select name="type" defaultValue={filters.fulfillment} className={inputClass}>
            <option value="all">Both</option>
            <option value="pickup">Pickup</option>
            <option value="delivery">Delivery</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-semibold">Event from</span>
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-semibold">Event to</span>
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={inputClass} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="focus-ring min-h-11 flex-1 rounded-xl bg-brand-teal-deep px-4 text-sm font-semibold text-white">
            Apply
          </button>
          <Link href="/admin/catering" className="focus-ring inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold hover:bg-muted">
            Clear
          </Link>
        </div>
      </form>

      <DataTable<CateringRequestSummary>
        caption="Catering requests"
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/catering/${r.id}`}
        empty="No catering requests match."
        search={{ value: filters.search, placeholder: "Search by request number, name or email", keep }}
        pagination={{
          page: filters.page,
          pageSize: INBOX_PAGE_SIZE,
          total,
          hrefFor: (page) => `/admin/catering${queryString({ ...keep, q: filters.search, page })}`,
        }}
        columns={[
          {
            header: "Request",
            primary: true,
            cell: (r) => (
              <span className="inline-flex items-center gap-2">
                <span className="tabular">{r.requestNumber}</span>
                {r.isNew ? (
                  <span className="rounded-full bg-brand-magenta-deep px-2 py-0.5 text-xs font-bold text-white" data-testid="catering-new-badge">
                    New
                  </span>
                ) : null}
              </span>
            ),
          },
          { header: "Event", cell: (r) => eventWhen(r.eventAt) },
          { header: "Customer", cell: (r) => r.contactName ?? "(account deleted)" },
          { header: "Guests", cell: (r) => <span className="tabular">{r.headcount}</span>, className: "text-right" },
          { header: "Type", cell: (r) => (r.fulfillment === "delivery" ? "Delivery" : "Pickup") },
          {
            header: "Status",
            cell: (r) => (
              <span className="inline-flex flex-wrap items-center gap-1">
                <CateringStatusBadge status={r.status} />
                {r.cancellationRequested && r.status === "confirmed" ? (
                  <span className="text-xs font-semibold text-destructive">Cancellation asked</span>
                ) : null}
              </span>
            ),
          },
          { header: "Quote", cell: (r) => (r.totalCents !== null ? <span className="tabular">{formatCents(r.totalCents)}</span> : "—"), className: "text-right" },
        ]}
      />
    </div>
  );
}

async function CalendarView({ params }: { params: Awaited<SearchParams> }) {
  const mode = firstParam(params.mode) === "week" ? "week" : "month";
  const today = cafeDateKey(await appNow());
  const anchor = DATE.test(firstParam(params.date) ?? "") ? firstParam(params.date)! : today;
  const weeks = mode === "month" ? monthGrid(anchor) : [weekKeys(anchor)];
  const days = weeks.flat();
  const { from, to } = rangeOf(days);
  const entries = await listCateringCalendar(from, to);
  const byDay = new Map<string, CalendarEntry[]>();
  for (const entry of entries) {
    const key = cafeDateKey(new Date(entry.eventAt));
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }
  const prev = mode === "month" ? shiftMonth(anchor, -1) : addDaysToKey(anchor, -7);
  const next = mode === "month" ? shiftMonth(anchor, 1) : addDaysToKey(anchor, 7);
  const title =
    mode === "month"
      ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthOf(anchor)}-15T12:00:00Z`))
      : `Week of ${formatCafeDateLong(new Date(`${days[0]}T12:00:00-10:00`))}`;
  const link = (date: string, m = mode) => `/admin/catering${queryString({ view: "calendar", mode: m, date })}`;

  const Entry = ({ entry }: { entry: CalendarEntry }) => (
    <Link
      href={`/admin/catering/${entry.id}`}
      className={cn(
        "focus-ring block rounded-lg px-2 py-1 text-xs leading-tight",
        entry.status === "quoted" ? "bg-brand-pink-soft text-brand-magenta-deep" : "bg-brand-teal-soft text-brand-teal-deep",
      )}
    >
      <span className="font-bold">{formatCafeTimeOfDay(new Date(entry.eventAt))}</span> {entry.contactName ?? entry.requestNumber}
      <span className="block">
        {entry.headcount} guests · {CATERING_STATUS_LABELS[entry.status]}
      </span>
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={link(prev)} className="focus-ring inline-flex size-11 items-center justify-center rounded-xl border hover:bg-muted" aria-label={mode === "month" ? "Previous month" : "Previous week"}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <Link href={link(today)} className="focus-ring inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold hover:bg-muted">
            Today
          </Link>
          <Link href={link(next)} className="focus-ring inline-flex size-11 items-center justify-center rounded-xl border hover:bg-muted" aria-label={mode === "month" ? "Next month" : "Next week"}>
            <ChevronRight className="size-5" aria-hidden="true" />
          </Link>
          <Link href={link(anchor, "month")} className={tabClass(mode === "month")} aria-current={mode === "month" ? "true" : undefined}>
            Month
          </Link>
          <Link href={link(anchor, "week")} className={tabClass(mode === "week")} aria-current={mode === "week" ? "true" : undefined}>
            Week
          </Link>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Quoted <span className="rounded bg-brand-pink-soft px-1.5 text-brand-magenta-deep">pink</span> and confirmed{" "}
        <span className="rounded bg-brand-teal-soft px-1.5 text-brand-teal-deep">teal</span> events, Honolulu time.
      </p>

      {/* Phones: an agenda. */}
      <ol className="space-y-3 md:hidden" aria-label="Events by day">
        {days.filter((day) => byDay.has(day)).length === 0 ? (
          <li className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No quoted or confirmed events in this {mode}.</li>
        ) : (
          days
            .filter((day) => byDay.has(day))
            .map((day) => (
              <li key={day} className="rounded-2xl border bg-card p-3">
                <p className="mb-2 text-sm font-bold">{formatCafeDateLong(new Date(`${day}T12:00:00-10:00`))}</p>
                <div className="space-y-1">
                  {byDay.get(day)!.map((entry) => (
                    <Entry key={entry.id} entry={entry} />
                  ))}
                </div>
              </li>
            ))
        )}
      </ol>

      {/* Wider: the grid. */}
      <div className="hidden overflow-hidden rounded-2xl border bg-card md:block" data-testid="catering-calendar">
        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 divide-x border-b last:border-b-0">
            {week.map((day) => {
              const outside = mode === "month" && monthOf(day) !== monthOf(anchor);
              return (
                <div key={day} className={cn("min-h-28 space-y-1 p-1.5", outside && "bg-muted/30", mode === "week" && "min-h-64")}>
                  <p className={cn("text-right text-xs font-semibold", day === today ? "text-brand-magenta-deep" : outside ? "text-muted-foreground" : "")}>
                    {Number(day.slice(8))}
                  </p>
                  {(byDay.get(day) ?? []).map((entry) => (
                    <Entry key={entry.id} entry={entry} />
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

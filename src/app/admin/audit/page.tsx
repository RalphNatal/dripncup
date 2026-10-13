import type { Metadata } from "next";
import Link from "next/link";

import { AuditChanges } from "@/components/admin/audit-changes";
import { queryString } from "@/components/admin/data-table";
import { inputClass } from "@/components/admin/form-layout";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { AUDIT_TABLES, listAudit, listAuditActors } from "@/lib/admin/audit";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { firstParam } from "@/lib/search-params";
import { formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Audit log · Admin" };

const ACTION: Record<string, { label: string; tone: "good" | "info" | "bad" | "neutral" }> = {
  create: { label: "Created", tone: "good" },
  update: { label: "Changed", tone: "info" },
  delete: { label: "Deleted", tone: "bad" },
  import: { label: "Imported", tone: "good" },
};

const PAGE_SIZE = 25;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/audit");
  const params = await searchParams;
  const actor = firstParam(params.actor);
  const table = firstParam(params.table);
  const row = firstParam(params.row);
  const from = firstParam(params.from);
  const to = firstParam(params.to);
  const page = Math.max(1, Number(firstParam(params.page)) || 1);
  const filters = {
    actor: isUuid(actor) ? actor : undefined,
    table: table && table in AUDIT_TABLES ? table : undefined,
    rowId: row && row.length <= 200 ? row : undefined,
    from: from && DATE.test(from) ? from : undefined,
    to: to && DATE.test(to) ? to : undefined,
  };
  const [{ entries, total }, actors] = await Promise.all([listAudit({ ...filters, page, pageSize: PAGE_SIZE }), listAuditActors()]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => `/admin/audit${queryString({ actor: filters.actor, table: filters.table, row: filters.rowId, from: filters.from, to: filters.to, page: p })}`;

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="Audit log"
        description="Every change an admin made: who, when, and what it was before and after. Times are Honolulu time."
      />

      <form method="get" className="mb-5 grid gap-3 rounded-3xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filter the audit log">
        {filters.rowId ? <input type="hidden" name="row" value={filters.rowId} /> : null}
        <label className="space-y-1 text-sm font-semibold">
          Person
          <select name="actor" defaultValue={filters.actor ?? ""} className={inputClass}>
            <option value="">Everyone</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          What
          <select name="table" defaultValue={filters.table ?? ""} className={inputClass}>
            <option value="">Everything</option>
            {Object.entries(AUDIT_TABLES)
              .sort((a, b) => a[1].label.localeCompare(b[1].label))
              .map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          From
          <input type="date" name="from" defaultValue={filters.from} className={inputClass} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          To
          <input type="date" name="to" defaultValue={filters.to} className={inputClass} />
        </label>
        <div className="flex items-end gap-2">
          <button type="submit" className="focus-ring min-h-11 flex-1 rounded-xl bg-brand-teal-deep px-4 text-sm font-semibold text-white">
            Filter
          </button>
          <Link href="/admin/audit" className="focus-ring inline-flex min-h-11 items-center rounded-xl border px-3 text-sm font-semibold hover:bg-muted">
            Clear
          </Link>
        </div>
      </form>
      {filters.rowId ? (
        <p className="mb-3 text-sm text-muted-foreground">
          Showing one record&apos;s history.{" "}
          <Link
            href={`/admin/audit${queryString({ actor: filters.actor, table: filters.table, from: filters.from, to: filters.to })}`}
            className="font-semibold text-brand-teal-deep underline"
          >
            Show all records
          </Link>
        </p>
      ) : null}

      {entries.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No changes match. Try a wider date range, or clear the filters.</p>
      ) : (
        <ol className="space-y-3" aria-label="Changes, newest first" data-testid="audit-entries">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-3xl border bg-card p-4" data-testid="audit-entry">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusPill tone={ACTION[entry.action].tone}>{ACTION[entry.action].label}</StatusPill>
                <span className="font-semibold">{entry.tableLabel}</span>
                {entry.rowLabel ? (
                  entry.href ? (
                    <Link href={entry.href} className="font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
                      {entry.rowLabel}
                    </Link>
                  ) : (
                    <span>{entry.rowLabel}</span>
                  )
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.actorName ?? "An admin"} · {formatCafeDateTime(new Date(entry.createdAt))}
              </p>
              {entry.summary ? <p className="mt-2 text-sm">{entry.summary}</p> : null}
              <div className="mt-2">
                <AuditChanges changes={entry.changes} action={entry.action} />
              </div>
            </li>
          ))}
        </ol>
      )}

      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Page {page} of {pages} · {total} changes
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={href(page - 1)} className="focus-ring inline-flex min-h-11 items-center rounded-xl border px-3 font-semibold hover:bg-muted">
                Newer
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={href(page + 1)} className="focus-ring inline-flex min-h-11 items-center rounded-xl border px-3 font-semibold hover:bg-muted">
                Older
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A server-rendered admin table with search and pagination, driven by the
 * URL (so it works without JavaScript, survives a reload and can be
 * linked). The page reads `q` and `page` from its search params, queries,
 * and passes the rows here. Below `md` each row becomes a card.
 */
export interface DataTableColumn<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  /** Shown as the card's title on phones (one column should be). */
  primary?: boolean;
  className?: string;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  empty,
  search,
  pagination,
}: {
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Makes the primary cell a link to the row's page. */
  rowHref?: (row: Row) => string;
  empty: ReactNode;
  search?: {
    value: string;
    placeholder: string;
    /** Other params to keep when searching (filters). */
    keep: Record<string, string | undefined>;
  };
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    hrefFor: (page: number) => string;
  };
}) {
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const primaryCell = (row: Row, column: DataTableColumn<Row>) =>
    rowHref && column.primary ? (
      <Link href={rowHref(row)} className="focus-ring rounded font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
        {column.cell(row)}
      </Link>
    ) : (
      column.cell(row)
    );

  return (
    <div className="space-y-3">
      {search ? (
        <form method="get" role="search" className="flex max-w-md gap-2">
          {Object.entries(search.keep).map(([name, value]) =>
            value ? <input key={name} type="hidden" name={name} value={value} /> : null,
          )}
          <label className="relative flex-1">
            <span className="sr-only">{search.placeholder}</span>
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              name="q"
              defaultValue={search.value}
              placeholder={search.placeholder}
              className="focus-ring h-11 w-full rounded-xl border bg-card pr-3 pl-9 text-sm"
            />
          </label>
          <button type="submit" className="focus-ring min-h-11 rounded-xl border px-4 text-sm font-semibold hover:bg-muted">
            Search
          </button>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <>
          {/* Phones: cards. */}
          <ul className="space-y-2 md:hidden" aria-label={caption}>
            {rows.map((row) => (
              <li key={rowKey(row)} className="rounded-2xl border bg-card p-4">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {columns.map((column) =>
                    column.primary ? (
                      <div key={column.header} className="col-span-2 mb-1 text-base">
                        <dt className="sr-only">{column.header}</dt>
                        <dd>{primaryCell(row, column)}</dd>
                      </div>
                    ) : (
                      <div key={column.header} className="contents">
                        <dt className="text-muted-foreground">{column.header}</dt>
                        <dd className="min-w-0">{column.cell(row)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table. */}
          <div className="hidden overflow-x-auto rounded-2xl border bg-card md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="border-b bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  {columns.map((column) => (
                    <th key={column.header} scope="col" className={cn("px-4 py-3 font-semibold", column.className)}>
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => (
                  <tr key={rowKey(row)} className="hover:bg-muted/30">
                    {columns.map((column) => (
                      <td key={column.header} className={cn("px-4 py-3 align-top", column.className)}>
                        {primaryCell(row, column)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pagination && pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Page {pagination.page} of {pages} · {pagination.total} total
          </p>
          <div className="flex gap-2">
            {pagination.page > 1 ? (
              <Link href={pagination.hrefFor(pagination.page - 1)} className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-xl border px-3 font-semibold hover:bg-muted">
                <ChevronLeft className="size-4" aria-hidden="true" />
                Previous
              </Link>
            ) : null}
            {pagination.page < pages ? (
              <Link href={pagination.hrefFor(pagination.page + 1)} className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-xl border px-3 font-semibold hover:bg-muted">
                Next
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}

/** "?a=1&b=2" from params, dropping empty ones. */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

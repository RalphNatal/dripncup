/**
 * The before and after of an audited change, one line per changed column.
 * Values are shown as the admin would read them: money in dollars, yes/no,
 * long text shortened.
 */
import type { AuditChange } from "@/lib/admin/audit";
import { formatCents } from "@/lib/money";

/** "base_price_cents" -> "Base price". */
export function columnLabel(column: string): string {
  const text = column.replace(/_cents$/, "").replace(/_id$/, "").replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatAuditValue(column: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return column.endsWith("_cents") ? formatCents(value) : String(value);
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 159)}…` : value;
  const json = JSON.stringify(value);
  return json.length > 160 ? `${json.slice(0, 159)}…` : json;
}

export function AuditChanges({ changes, action }: { changes: AuditChange[]; action: "create" | "update" | "delete" | "import" }) {
  if (changes.length === 0) return null;
  const shown = changes.slice(0, 8);
  const rest = changes.slice(8);
  const line = (c: AuditChange) => (
    <li key={c.column} className="break-words">
      <span className="font-semibold">{columnLabel(c.column)}:</span>{" "}
      {action === "update" ? (
        <>
          <del className="text-muted-foreground">{formatAuditValue(c.column, c.from)}</del> → <ins className="no-underline">{formatAuditValue(c.column, c.to)}</ins>
        </>
      ) : (
        formatAuditValue(c.column, action === "delete" ? c.from : c.to)
      )}
    </li>
  );
  return (
    <div className="text-sm">
      <ul className="space-y-0.5">{shown.map(line)}</ul>
      {rest.length ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-sm font-semibold text-brand-teal-deep">{rest.length} more</summary>
          <ul className="mt-1 space-y-0.5">{rest.map(line)}</ul>
        </details>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Upload -> preview -> confirm. Previewing changes nothing. Applying sends
 * the same file again (the server re-checks it from scratch) and runs in one
 * transaction: every row or none.
 */
import { CircleAlert, FileSpreadsheet, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { applyImportAction, previewImportAction, type ImportCheck } from "@/lib/menu-import/actions";
import type { PreviewItem } from "@/lib/menu-import/preview";

import { ConfirmDialog } from "./confirm-dialog";
import { StatusPill } from "./status-pill";

function ItemList({ title, items, tone, testId }: { title: string; items: PreviewItem[]; tone: "good" | "info" | "neutral"; testId: string }) {
  if (items.length === 0) return null;
  return (
    <details className="rounded-2xl border bg-card" open={tone !== "neutral"} data-testid={testId}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 font-semibold">
        <StatusPill tone={tone}>{items.length}</StatusPill>
        {title}
      </summary>
      <ul className="divide-y border-t">
        {items.map((item) => (
          <li key={item.slug} className="px-4 py-2 text-sm">
            <p>
              <span className="font-semibold">{item.name}</span> <span className="text-muted-foreground">· {item.categoryName} · row {item.row}</span>
            </p>
            <p className="tabular text-muted-foreground">{item.price}</p>
            {item.changes.length ? (
              <ul className="mt-1 list-disc pl-5">
                {item.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ImportForm() {
  const id = useId();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [archiveMissing, setArchiveMissing] = useState(false);

  async function preview(event?: React.FormEvent) {
    event?.preventDefault();
    if (!form.current) return;
    setChecking(true);
    try {
      const result = await previewImportAction(new FormData(form.current));
      setCheck(result);
      if (!result.ok) toast.error(result.message);
    } finally {
      setChecking(false);
    }
  }

  async function apply(): Promise<boolean> {
    if (!form.current) return false;
    const data = new FormData(form.current);
    data.set("confirm", "yes");
    const result = await applyImportAction(data);
    if (!result.ok) {
      toast.error(result.message);
      if (result.errors) setCheck((c) => (c && c.ok ? { ...c, errors: result.errors!, preview: null } : c));
      return false;
    }
    toast.success(result.message);
    setCheck(null);
    form.current.reset();
    setArchiveMissing(false);
    router.refresh();
    return true;
  }

  const p = check?.ok ? check.preview : null;
  const changes = p ? p.creates.length + p.updates.length + p.archives.length + p.newCategories.length : 0;

  return (
    <div className="space-y-5">
      <form ref={form} onSubmit={preview} className="space-y-4 rounded-3xl border bg-card p-5" aria-label="Upload a menu spreadsheet">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-file`} className="block font-semibold">
            Spreadsheet (.xlsx or .csv, up to 2 MB)
          </label>
          <input
            id={`${id}-file`}
            name="file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            onChange={() => setCheck(null)}
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-full file:border-0 file:bg-brand-teal-soft file:px-4 file:font-semibold file:text-brand-teal-deep"
          />
        </div>
        <label className="flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="archiveMissing"
            checked={archiveMissing}
            onChange={(e) => {
              setArchiveMissing(e.target.checked);
              setCheck(null);
            }}
            className="mt-0.5 size-5 accent-[var(--brand-teal-deep)]"
          />
          <span>
            <span className="font-semibold">Archive items that aren&apos;t in the file</span>
            <span className="block text-muted-foreground">Off: items missing from the file are left as they are. Nothing is ever deleted.</span>
          </span>
        </label>
        <button type="submit" disabled={checking} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white disabled:opacity-60">
          {checking ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <FileSpreadsheet className="size-4" aria-hidden="true" />}
          Preview (changes nothing)
        </button>
      </form>

      {check?.ok ? (
        <section aria-labelledby={`${id}-result`} className="space-y-3" data-testid="import-preview">
          <h2 id={`${id}-result`} className="text-xl font-bold">
            {check.errors.length ? `${check.errors.length} problem${check.errors.length === 1 ? "" : "s"} in ${check.fileName}` : `Preview of ${check.fileName}`}
          </h2>
          {check.errors.length ? (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4" role="alert" data-testid="import-errors">
              <p className="flex items-center gap-2 font-semibold">
                <CircleAlert className="size-5 text-destructive" aria-hidden="true" />
                Fix these in the spreadsheet and preview again. Nothing has been changed.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {check.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-semibold">{e.row ? `Row ${e.row}` : "File"}{e.column ? `, ${e.column}` : ""}:</span> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : p ? (
            <>
              <p className="text-sm text-muted-foreground" data-testid="import-summary">
                {check.rowCount} row{check.rowCount === 1 ? "" : "s"}: {p.creates.length} new, {p.updates.length} changed, {p.unchanged.length} unchanged
                {archiveMissing ? `, ${p.archives.length} to archive` : ""}
                {p.newCategories.length ? `; new categories: ${p.newCategories.map((c) => c.name).join(", ")}` : ""}.
              </p>
              <ItemList title="New items" items={p.creates} tone="good" testId="import-creates" />
              <ItemList title="Changed items" items={p.updates} tone="info" testId="import-updates" />
              <ItemList title="Unchanged" items={p.unchanged} tone="neutral" testId="import-unchanged" />
              {p.archives.length ? (
                <div className="rounded-2xl border p-4 text-sm">
                  <p className="font-semibold">To archive ({p.archives.length})</p>
                  <p className="mt-1 text-muted-foreground">{p.archives.map((a) => a.name).join(", ")}</p>
                </div>
              ) : null}
              <ConfirmDialog
                trigger={
                  <button type="button" disabled={changes === 0} className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white disabled:opacity-50">
                    {changes === 0 ? "Nothing to change" : "Apply import"}
                  </button>
                }
                title="Apply this import?"
                description={`This adds ${p.creates.length} item(s), changes ${p.updates.length}${archiveMissing ? `, archives ${p.archives.length}` : ""}${p.newCategories.length ? ` and adds ${p.newCategories.length} categor${p.newCategories.length === 1 ? "y" : "ies"}` : ""}, all at once. Customers see the changes straight away; past orders keep their prices. It's recorded in the audit log as one import.`}
                confirmLabel="Apply import"
                pendingLabel="Importing…"
                onConfirm={apply}
              />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ImportForm } from "@/components/admin/import-form";
import { MenuNav } from "@/components/admin/menu-nav";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { IMPORT_COLUMNS } from "@/lib/menu-import/format";

export const metadata: Metadata = { title: "Import the menu · Admin" };

const DOWNLOADS = [
  { file: "template.xlsx", label: "Template (Excel)" },
  { file: "template.csv", label: "Template (CSV)" },
  { file: "example.xlsx", label: "Filled-in example (Excel)" },
  { file: "example.csv", label: "Filled-in example (CSV)" },
];

export default async function ImportPage() {
  await requireRole(["admin"], "/admin/menu/import");

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="Import the menu"
        description="Add or update many items from a spreadsheet. Items are matched by their slug, so importing the same file again updates them instead of adding copies."
      />
      <MenuNav current="/admin/menu/import" />

      <section aria-labelledby="downloads" className="mb-5 rounded-3xl border bg-card p-5">
        <h2 id="downloads" className="text-lg font-bold">
          1. Start from the template
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {DOWNLOADS.map((d) => (
            <li key={d.file}>
              <a
                href={`/admin/menu/import/template?file=${d.file}`}
                download
                className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold hover:bg-muted"
              >
                <Download className="size-4" aria-hidden="true" />
                {d.label}
              </a>
            </li>
          ))}
        </ul>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold text-brand-teal-deep">What goes in each column</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
            {IMPORT_COLUMNS.map((c) => (
              <div key={c.key} className="contents">
                <dt className="font-semibold">
                  {c.header}
                  {c.required ? " (required)" : ""}
                </dt>
                <dd className="text-muted-foreground">{c.help}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-muted-foreground">
            Modifier groups must exist first (see{" "}
            <Link href="/admin/menu/modifiers" className="font-semibold text-brand-teal-deep underline">
              Modifiers
            </Link>
            ). Photos are added on each product&apos;s page after importing.
          </p>
        </details>
      </section>

      <h2 className="mb-3 text-lg font-bold">2. Upload and preview</h2>
      <ImportForm />
    </div>
  );
}

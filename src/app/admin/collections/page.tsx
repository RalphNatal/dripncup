import { Plus } from "lucide-react";
import type { Metadata } from "next";

import { DataTable } from "@/components/admin/data-table";
import { AdminButtonLink, AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { listAdminCollections, type AdminCollectionRow } from "@/lib/collections/queries";
import { formatCafeDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Collections · Admin" };

const PHASE_LABEL = { upcoming: "Upcoming", active: "Showing now", ended: "Ended" } as const;

export default async function AdminCollectionsPage() {
  await requireRole(["admin"], "/admin/collections");
  const collections = await listAdminCollections();

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="Seasonal collections"
        description="Shown on the menu and Home between their dates, automatically. Honolulu time."
        actions={
          <AdminButtonLink href="/admin/collections/new">
            <Plus className="size-4" aria-hidden="true" />
            New collection
          </AdminButtonLink>
        }
      />
      <DataTable<AdminCollectionRow>
        caption="Seasonal collections"
        rows={collections}
        rowKey={(c) => c.id}
        rowHref={(c) => `/admin/collections/${c.id}`}
        empty="No collections yet."
        columns={[
          {
            header: "Collection",
            primary: true,
            cell: (c) => (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-3 rounded-full border" style={{ backgroundColor: c.accentColor ?? "var(--brand-magenta)" }} />
                {c.name}
              </span>
            ),
          },
          { header: "From", cell: (c) => formatCafeDateTime(new Date(c.startsAt)) },
          { header: "Until", cell: (c) => formatCafeDateTime(new Date(c.endsAt)) },
          { header: "Products", cell: (c) => c.productCount, className: "text-right" },
          {
            header: "Status",
            cell: (c) => (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-bold",
                  !c.isActive ? "bg-muted text-muted-foreground" : c.phase === "active" ? "bg-brand-teal-soft text-brand-teal-deep" : "bg-muted",
                )}
              >
                {c.isActive ? PHASE_LABEL[c.phase] : "Switched off"}
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

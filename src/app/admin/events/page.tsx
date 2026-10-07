import { Plus } from "lucide-react";
import type { Metadata } from "next";

import { DataTable } from "@/components/admin/data-table";
import { AdminButtonLink, AdminPageHeader } from "@/components/admin/page-header";
import { eventWindowLabel } from "@/components/events/event-card";
import { requireRole } from "@/lib/auth/dal";
import { listAdminEvents, type AdminEventRow } from "@/lib/events/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Events · Admin" };

function PublishedBadge({ row }: { row: AdminEventRow }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", row.isPublished ? "bg-brand-teal-soft text-brand-teal-deep" : "bg-muted text-muted-foreground")}>
      {row.isPublished ? "Published" : "Draft"}
    </span>
  );
}

export default async function AdminEventsPage() {
  await requireRole(["admin"], "/admin/events");
  const { events } = await listAdminEvents();
  const groups = [
    { key: "live", title: "Live now", rows: events.filter((e) => e.phase === "live") },
    { key: "upcoming", title: "Upcoming", rows: events.filter((e) => e.phase === "upcoming") },
    { key: "past", title: "Past", rows: events.filter((e) => e.phase === "past").reverse() },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="Pop-up events"
        description="One row per day. Drafts are invisible to customers until you publish them."
        actions={
          <AdminButtonLink href="/admin/events/new">
            <Plus className="size-4" aria-hidden="true" />
            New event
          </AdminButtonLink>
        }
      />
      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.key} aria-labelledby={`events-${group.key}`} className="space-y-3" data-testid={`admin-events-${group.key}`}>
            <h2 id={`events-${group.key}`} className="text-xl font-bold">
              {group.title} <span className="text-base font-normal text-muted-foreground">({group.rows.length})</span>
            </h2>
            <DataTable<AdminEventRow>
              caption={`${group.title} events`}
              rows={group.rows}
              rowKey={(r) => r.id}
              rowHref={(r) => `/admin/events/${r.id}`}
              empty={group.key === "past" ? "No past events." : `No ${group.title.toLowerCase()} events.`}
              columns={[
                { header: "Event", primary: true, cell: (r) => r.name },
                { header: "When", cell: (r) => eventWindowLabel(r) },
                { header: "Where", cell: (r) => r.place || "—" },
                { header: "Menu", cell: (r) => `${r.menuCount} items`, className: "whitespace-nowrap" },
                { header: "Staff", cell: (r) => r.staffCount, className: "text-right" },
                { header: "Status", cell: (r) => <PublishedBadge row={r} /> },
              ]}
            />
          </section>
        ))}
      </div>
    </div>
  );
}

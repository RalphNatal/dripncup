import { Plus } from "lucide-react";
import type { Metadata } from "next";

import { DataTable } from "@/components/admin/data-table";
import { MenuNav } from "@/components/admin/menu-nav";
import { AdminButtonLink, AdminPageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { requireRole } from "@/lib/auth/dal";
import { groupProductCounts, listAdminGroups } from "@/lib/menu-admin/queries";
import type { AdminGroup } from "@/lib/menu-admin/rules";

export const metadata: Metadata = { title: "Modifiers · Admin" };

function rule(group: AdminGroup): string {
  if (group.selectionType === "single") return group.isRequired ? "Choose one (required)" : "Choose one (optional)";
  const max = group.maxSelections === null ? "any number" : `up to ${group.maxSelections}`;
  return `${group.isRequired ? `At least ${group.minSelections}, ` : ""}${max}${group.maxQuantityPerOption > 1 ? `, ${group.maxQuantityPerOption} ${group.quantityUnit ?? "unit"}s each` : ""}`;
}

export default async function ModifiersPage() {
  await requireRole(["admin"], "/admin/menu/modifiers");
  const [groups, counts] = await Promise.all([listAdminGroups(), groupProductCounts()]);

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="Modifier groups"
        description="Customisation shared between products: milk, shots, flavors, sweetness, ice. Attach them to products on each product's page."
        actions={
          <AdminButtonLink href="/admin/menu/modifiers/new">
            <Plus className="size-4" aria-hidden="true" />
            New group
          </AdminButtonLink>
        }
      />
      <MenuNav current="/admin/menu/modifiers" />
      <DataTable<AdminGroup>
        caption="Modifier groups"
        rows={groups}
        rowKey={(g) => g.id}
        rowHref={(g) => `/admin/menu/modifiers/${g.id}`}
        empty="No modifier groups yet."
        columns={[
          { header: "Group", primary: true, cell: (g) => g.name },
          { header: "Short name", cell: (g) => <code className="text-xs">{g.slug}</code> },
          { header: "Rule", cell: rule },
          { header: "Options", cell: (g) => g.options.filter((o) => !o.archived).length, className: "text-right" },
          { header: "Products", cell: (g) => counts.get(g.id) ?? 0, className: "text-right" },
          {
            header: "Status",
            cell: (g) => (g.archived ? <StatusPill>Archived</StatusPill> : g.isActive ? <StatusPill tone="good">On</StatusPill> : <StatusPill tone="warn">Off</StatusPill>),
          },
        ]}
      />
    </div>
  );
}

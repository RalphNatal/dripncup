import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, queryString } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { requireRole } from "@/lib/auth/dal";
import { searchUsers, type AdminUserRow } from "@/lib/rewards/admin";
import { formatPoints } from "@/lib/rewards/model";
import { firstParam, type SearchParams } from "@/lib/search-params";
import { formatCafeDate } from "@/lib/time";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Users · Admin" };

const ROLE_FILTERS = [
  { id: "", label: "Everyone" },
  { id: "customer", label: "Customers" },
  { id: "staff", label: "Staff" },
  { id: "admin", label: "Admins" },
] as const;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/users");
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const roleParam = firstParam(params.role);
  const role = roleParam === "customer" || roleParam === "staff" || roleParam === "admin" ? roleParam : null;
  const page = Math.max(1, Number(firstParam(params.page)) || 1);
  const { rows, total } = await searchUsers(q, role, page);

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader title="Users" description="Customers, staff and admins. Change roles and staff locations on each person's page." />
      <nav aria-label="Filter by role" className="mb-4 flex flex-wrap gap-2">
        {ROLE_FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/admin/users${queryString({ q, role: f.id })}`}
            aria-current={(role ?? "") === f.id ? "page" : undefined}
            className={cn("focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold", (role ?? "") === f.id ? "border-brand-teal-deep bg-brand-teal-soft text-brand-teal-deep" : "hover:bg-muted")}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <DataTable<AdminUserRow>
        caption="Users"
        rows={rows}
        rowKey={(u) => u.id}
        rowHref={(u) => `/admin/users/${u.id}`}
        empty="Nobody matches."
        search={{ value: q, placeholder: "Name or email", keep: { role: role ?? undefined } }}
        pagination={{ page, pageSize: 25, total, hrefFor: (p) => `/admin/users${queryString({ q, role, page: p })}` }}
        columns={[
          { header: "Name", primary: true, cell: (u) => u.fullName || u.email || "—" },
          { header: "Email", cell: (u) => u.email ?? "" },
          { header: "Role", cell: (u) => <StatusPill tone={u.role === "admin" ? "info" : u.role === "staff" ? "good" : "neutral"}>{u.role}</StatusPill> },
          { header: "Points", cell: (u) => formatPoints(u.points), className: "text-right tabular" },
          { header: "Joined", cell: (u) => formatCafeDate(new Date(u.createdAt)) },
        ]}
      />
    </div>
  );
}

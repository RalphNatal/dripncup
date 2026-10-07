import type { Metadata } from "next";

import { DataTable, queryString } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { searchUsers, type AdminUserRow } from "@/lib/rewards/admin";
import { formatMemberCode, formatPoints } from "@/lib/rewards/model";
import { firstParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Members · Admin" };

export default async function MembersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/rewards/members");
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(firstParam(params.page)) || 1);
  const { rows, total } = q ? await searchUsers(q, null, page) : { rows: [], total: 0 };

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader backHref="/admin/rewards" backLabel="Rewards" title="Find a member" description="By member code (from their QR), email or name." />
      <DataTable<AdminUserRow>
        caption="Members"
        rows={rows}
        rowKey={(u) => u.id}
        rowHref={(u) => `/admin/rewards/members/${u.id}`}
        empty={q ? `No members match “${q}”.` : "Search to find a member."}
        search={{ value: q, placeholder: "Member code, email or name", keep: {} }}
        pagination={{ page, pageSize: 25, total, hrefFor: (p) => `/admin/rewards/members${queryString({ q, page: p })}` }}
        columns={[
          { header: "Member", primary: true, cell: (u) => u.fullName || u.email || "Member" },
          { header: "Email", cell: (u) => u.email ?? "" },
          { header: "Code", cell: (u) => <code className="text-xs">{formatMemberCode(u.memberCode)}</code> },
          { header: "Points", cell: (u) => formatPoints(u.points), className: "text-right tabular" },
        ]}
      />
    </div>
  );
}

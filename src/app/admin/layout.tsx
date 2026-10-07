import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { requireRole } from "@/lib/auth/dal";
import { countNewCateringRequests } from "@/lib/catering/queries";

/**
 * The admin frame. Admins only: the proxy gates /admin, this checks again,
 * and so does every page and Server Action under it (a layout alone is not a
 * guard: it does not re-run on every navigation).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const profile = await requireRole(["admin"], "/admin");
  const newCatering = await countNewCateringRequests();

  return (
    <AdminShell adminName={profile.first_name ?? profile.full_name ?? profile.email ?? "Admin"} newCatering={newCatering}>
      {children}
    </AdminShell>
  );
}

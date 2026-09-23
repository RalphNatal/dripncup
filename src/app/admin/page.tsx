import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Admin" };

/** Placeholder until the admin dashboard lands in Phase 9. */
export default async function AdminPage() {
  const profile = await requireRole(["admin"], "/admin");

  return (
    <PageShell title="Admin" backHref="/account" backLabel="Account">
      <Card className="rounded-2xl">
        <CardContent className="space-y-2 p-5">
          <p className="text-base">
            Signed in as <span className="font-semibold">{profile.first_name ?? profile.email}</span>.
          </p>
          <p className="text-sm text-muted-foreground">
            Menu, hours, promos, staff rosters and reports arrive in Phase 9.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}

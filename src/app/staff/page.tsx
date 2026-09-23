import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Staff" };

/** Placeholder until the live order queue lands in Phase 6. */
export default async function StaffPage() {
  const profile = await requireRole(["staff", "admin"], "/staff");

  // RLS scopes this to the staff member's roster; admins see every location.
  const supabase = await createClient();
  const { data: rostered } = await supabase
    .from("staff_locations")
    .select("location:locations(id, name)")
    .eq("profile_id", profile.id);

  const locations = (rostered ?? []).flatMap((row) => (row.location ? [row.location] : []));

  return (
    <PageShell title="Staff" backHref="/account" backLabel="Account">
      <Card className="rounded-2xl">
        <CardContent className="space-y-2 p-5">
          <p className="text-base">
            Signed in as <span className="font-semibold">{profile.first_name ?? profile.email}</span>.
          </p>
          {profile.role === "admin" ? (
            <p className="text-sm text-muted-foreground">As an admin you can see every location&apos;s queue.</p>
          ) : locations.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Rostered at: {locations.map((l) => l.name).join(", ")}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              You are not rostered to a location yet. Ask an admin to add you.
            </p>
          )}
          <p className="text-sm text-muted-foreground">The live order queue arrives in Phase 6.</p>
        </CardContent>
      </Card>
    </PageShell>
  );
}

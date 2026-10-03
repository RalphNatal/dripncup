import type { Metadata } from "next";

import { StaffDashboard } from "@/components/staff/staff-dashboard";
import { StaffNotice } from "@/components/staff/staff-notice";
import { requireRole } from "@/lib/auth/dal";
import { getStaffLocationOptions, loadStaffLocationContext, resolveStaffLocation } from "@/lib/staff/locations";

export const metadata: Metadata = { title: "Staff" };

type SearchParams = Promise<{ location?: string | string[] }>;

/**
 * The barista dashboard. The proxy already keeps customers out; this checks
 * the role again and picks the counter: `?location=` (a deep link), else the
 * one remembered on this device, else the first the staff member works.
 * Everything live happens in the client component, under the barista's own
 * session and RLS.
 */
export default async function StaffPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireRole(["staff", "admin"], "/staff");
  const { location } = await searchParams;
  const requested = typeof location === "string" ? location : undefined;

  const options = await getStaffLocationOptions(profile);
  const resolved = await resolveStaffLocation(options, requested);

  if (resolved.kind === "forbidden") {
    return (
      <StaffNotice
        title="Not your counter"
        body="You're not rostered at that location today, so its queue isn't available. Ask an admin if this is wrong."
        actionHref="/staff"
        actionLabel="Open my queue"
      />
    );
  }
  if (resolved.kind === "none") {
    return (
      <StaffNotice
        title="No counter to show"
        body="You're not rostered at a location that's open today. Ask an admin to add you."
        actionHref="/account"
        actionLabel="Back to my account"
      />
    );
  }

  const context = await loadStaffLocationContext(resolved.locationId);
  if (!context) {
    return <StaffNotice title="Location not found" body="That location no longer exists." actionHref="/staff" actionLabel="Open my queue" />;
  }

  return (
    <StaffDashboard
      key={context.id}
      location={context}
      options={options}
      viewer={{ id: profile.id, name: profile.first_name ?? profile.full_name ?? profile.email ?? "Staff", role: profile.role }}
    />
  );
}

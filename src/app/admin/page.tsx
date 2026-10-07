import { CalendarDays, ChefHat, Sparkles, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { countNewCateringRequests } from "@/lib/catering/queries";
import { appNow } from "@/lib/clock";
import { listAdminCollections } from "@/lib/collections/queries";
import { listAdminEvents } from "@/lib/events/queries";
import { startOfCafeDay } from "@/lib/time";

export const metadata: Metadata = { title: "Admin" };

function Stat({ href, icon: Icon, label, value, detail, testId }: { href: string; icon: LucideIcon; label: string; value: number; detail: string; testId: string }) {
  return (
    <Link href={href} className="focus-ring block rounded-3xl border bg-card p-5 hover:border-brand-teal-deep" data-testid={testId}>
      <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Icon className="size-5 text-brand-teal-deep" aria-hidden="true" />
        {label}
      </p>
      <p className="tabular mt-2 font-heading text-4xl font-extrabold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </Link>
  );
}

/** The admin home: what needs attention, at a glance. */
export default async function AdminHomePage() {
  const profile = await requireRole(["admin"], "/admin");
  const [newCatering, { events }, collections, now] = await Promise.all([
    countNewCateringRequests(),
    listAdminEvents(),
    listAdminCollections(),
    appNow(),
  ]);

  // "This week": from the start of today (Honolulu) for seven days.
  const weekStart = startOfCafeDay(now).getTime();
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  const eventsThisWeek = events.filter(
    (e) => e.isActive && Date.parse(e.endsAt) > weekStart && Date.parse(e.startsAt) < weekEnd,
  ).length;
  const activeCollections = collections.filter((c) => c.isActive && c.phase === "active").length;

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader title={`Aloha, ${profile.first_name ?? profile.full_name ?? "admin"}!`} description="What needs your attention today." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          href="/admin/catering?status=new"
          icon={ChefHat}
          label="New catering requests"
          value={newCatering}
          detail="New requests, changes and payments you haven't opened yet"
          testId="admin-stat-catering"
        />
        <Stat
          href="/admin/events"
          icon={CalendarDays}
          label="Events this week"
          value={eventsThisWeek}
          detail="Pop-ups running in the next seven days"
          testId="admin-stat-events"
        />
        <Stat
          href="/admin/collections"
          icon={Sparkles}
          label="Active collections"
          value={activeCollections}
          detail="Seasonal collections showing on the menu now"
          testId="admin-stat-collections"
        />
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        Menu, locations, settings, promotions, rewards, users and reports are coming soon.
      </p>
    </div>
  );
}

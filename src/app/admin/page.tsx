import { BarChart3, CalendarDays, ChefHat, ChevronRight, CircleSlash, ClipboardCheck, PauseCircle, Sparkles, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AttentionQueue } from "@/components/admin/attention-queue";
import { InfoTip } from "@/components/admin/info-tip";
import { AdminPageHeader } from "@/components/admin/page-header";
import { listAttentionItems } from "@/lib/admin/attention";
import { requireRole } from "@/lib/auth/dal";
import { countNewCateringRequests } from "@/lib/catering/queries";
import { appNow } from "@/lib/clock";
import { listAdminCollections } from "@/lib/collections/queries";
import { listAdminEvents } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { REPORT_DEFINITIONS, presetRange, sumSales } from "@/lib/reports/definitions";
import { getSalesDays } from "@/lib/reports/queries";
import { getSetupChecklist } from "@/lib/setup/queries";
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

function Figure({ label, value, definition, testId }: { label: string; value: string; definition: string; testId: string }) {
  return (
    <div className="rounded-3xl border bg-card p-5" data-testid={testId}>
      <p className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
        {label}
        <InfoTip label={label}>{definition}</InfoTip>
      </p>
      <p className="tabular font-heading text-3xl font-extrabold">{value}</p>
    </div>
  );
}

function QuickLink({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <Link href={href} className="focus-ring flex min-h-14 items-center gap-3 rounded-2xl border bg-card px-4 font-semibold hover:border-brand-teal-deep">
      <Icon className="size-5 text-brand-teal-deep" aria-hidden="true" />
      <span className="flex-1">{children}</span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** The admin home: what needs a person, today's numbers, and the daily shortcuts. */
export default async function AdminHomePage() {
  const profile = await requireRole(["admin"], "/admin");
  const now = await appNow();
  const today = presetRange("today", now);
  const [attention, newCatering, { events }, collections, todaysSales, setup] = await Promise.all([
    listAttentionItems(),
    countNewCateringRequests(),
    listAdminEvents(),
    listAdminCollections(),
    getSalesDays(today, null).catch(() => []),
    getSetupChecklist(),
  ]);
  const totals = sumSales(todaysSales);

  // "This week": from the start of today (Honolulu) for seven days.
  const weekStart = startOfCafeDay(now).getTime();
  const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
  const eventsThisWeek = events.filter(
    (e) => e.isActive && Date.parse(e.endsAt) > weekStart && Date.parse(e.startsAt) < weekEnd,
  ).length;
  const activeCollections = collections.filter((c) => c.isActive && c.phase === "active").length;
  const setupDone = setup.confirmed === setup.total;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <AdminPageHeader title={`Aloha, ${profile.first_name ?? profile.full_name ?? "admin"}!`} description="What needs your attention today." />

      {!setupDone ? (
        <Link href="/admin/setup" className="focus-ring block rounded-3xl border bg-brand-teal-soft/60 p-5 hover:border-brand-teal-deep" data-testid="setup-progress">
          <p className="flex items-center gap-2 font-semibold">
            <ClipboardCheck className="size-5 text-brand-teal-deep" aria-hidden="true" />
            Setup checklist: <span className="tabular">{setup.confirmed} of {setup.total} confirmed</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-background" role="progressbar" aria-label="Setup confirmed" aria-valuemin={0} aria-valuemax={setup.total} aria-valuenow={setup.confirmed}>
            <div className="h-full rounded-full bg-brand-teal-deep" style={{ width: `${Math.round((setup.confirmed / Math.max(1, setup.total)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-sm text-muted-foreground">Placeholders the owner still needs to confirm: menu, hours, policies, settings.</p>
        </Link>
      ) : null}

      <section aria-labelledby="attention-heading" className="space-y-3">
        <h2 id="attention-heading" className="text-xl font-bold">
          Needs attention {attention.length ? <span className="tabular text-muted-foreground">({attention.length})</span> : null}
        </h2>
        <AttentionQueue items={attention} />
      </section>

      <section aria-labelledby="today-heading" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="today-heading" className="text-xl font-bold">
            Today
          </h2>
          <Link href="/admin/reports?preset=today" className="text-sm font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
            Today&apos;s report
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Figure label="Net sales" value={formatCents(totals.netSalesCents)} definition={REPORT_DEFINITIONS.net} testId="today-net-sales" />
          <Figure label="Orders" value={String(totals.orders)} definition={REPORT_DEFINITIONS.orders} testId="today-orders" />
          <Figure label="Average order" value={formatCents(totals.averageOrderValueCents)} definition={REPORT_DEFINITIONS.aov} testId="today-aov" />
        </div>
      </section>

      <section aria-labelledby="quick-heading" className="space-y-3">
        <h2 id="quick-heading" className="text-xl font-bold">
          Quick actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickLink href="/admin/locations#pause" icon={PauseCircle}>
            Pause online orders
          </QuickLink>
          <QuickLink href="/admin/menu/sold-out" icon={CircleSlash}>
            Sold out
          </QuickLink>
          <QuickLink href="/admin/catering" icon={ChefHat}>
            Catering inbox
          </QuickLink>
          <QuickLink href="/admin/reports" icon={BarChart3}>
            Reports
          </QuickLink>
        </div>
      </section>

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
    </div>
  );
}

import { Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { InfoTip } from "@/components/admin/info-tip";
import { AdminButtonLink, AdminPageHeader } from "@/components/admin/page-header";
import { SettingField } from "@/components/admin/setting-field";
import { SortableList } from "@/components/admin/sortable-list";
import { StatusPill } from "@/components/admin/status-pill";
import { requireRole } from "@/lib/auth/dal";
import { getRewardsTotals, listAdminTiers } from "@/lib/rewards/admin";
import { reorderTiersAction } from "@/lib/rewards/admin-actions";
import { formatPoints, tierDetails } from "@/lib/rewards/model";
import { getStoredSettings } from "@/lib/settings/queries";
import { settingInputValue, settingsInSection } from "@/lib/settings/registry";

export const metadata: Metadata = { title: "Rewards · Admin" };

function Total({ label, value, help }: { label: string; value: number; help: string }) {
  return (
    <div className="rounded-3xl border bg-card p-4">
      <p className="flex items-center gap-1 text-sm font-semibold text-muted-foreground">
        {label}
        <InfoTip label={label}>{help}</InfoTip>
      </p>
      <p className="tabular font-heading text-2xl font-extrabold">{formatPoints(value)}</p>
    </div>
  );
}

export default async function RewardsAdminPage() {
  await requireRole(["admin"], "/admin/rewards");
  const [tiers, totals, stored] = await Promise.all([listAdminTiers(), getRewardsTotals(), getStoredSettings()]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <AdminPageHeader
        title="Overflow Rewards"
        description="Tiers, how points are earned, and members' balances."
        actions={
          <>
            <Link href="/admin/rewards/members" className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border px-5 text-sm font-semibold hover:bg-muted">
              <Search className="size-4" aria-hidden="true" />
              Find a member
            </Link>
            <AdminButtonLink href="/admin/rewards/tiers/new">
              <Plus className="size-4" aria-hidden="true" />
              New reward
            </AdminButtonLink>
          </>
        }
      />

      <section aria-labelledby="totals" className="space-y-3">
        <h2 id="totals" className="text-xl font-bold">
          Programme totals
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Total label="Issued" value={totals.issued} help="Points earned at pickup, plus points added by hand." />
          <Total label="Redeemed" value={totals.redeemed} help="Points spent on rewards, less points returned when an order was cancelled." />
          <Total label="Outstanding" value={totals.outstanding} help={`What open accounts hold now (${totals.membersWithPoints} members with points).`} />
          <Total label="Taken back" value={totals.reversed + totals.expired + totals.adjustedOut} help="Reversed after refunds, expired, or taken off by hand." />
        </div>
      </section>

      <section aria-labelledby="tiers" className="space-y-3">
        <h2 id="tiers" className="text-xl font-bold">
          Reward tiers
        </h2>
        <p className="text-sm text-muted-foreground">In the order customers see them. Drag, or use the arrows, to reorder.</p>
        {tiers.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No rewards yet. Add a tier so members have something to save up for.</p>
        ) : (
          <SortableList
            label="Reward tiers"
            onSave={reorderTiersAction}
            items={tiers.map((t) => ({
              id: t.id,
              label: `${t.name} · ${formatPoints(t.pointsCost)}`,
              muted: !t.isActive,
              content: (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="hidden text-sm text-muted-foreground lg:inline">{tierDetails(t)}</span>
                  {t.isActive ? <StatusPill tone="good">On</StatusPill> : <StatusPill tone="warn">Off</StatusPill>}
                  <Link href={`/admin/rewards/tiers/${t.id}`} className="focus-ring inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-brand-teal-deep hover:underline">
                    Edit<span className="sr-only"> {t.name}</span>
                  </Link>
                </span>
              ),
            }))}
          />
        )}
      </section>

      <section aria-labelledby="program" className="rounded-3xl border bg-card p-5 md:p-6">
        <h2 id="program" className="mb-4 text-xl font-bold">
          Programme settings
        </h2>
        {settingsInSection("rewards").map((def) => {
          const row = stored.get(def.key);
          return (
            <SettingField
              key={def.key}
              version={row?.updatedAt ?? ""}
              def={def}
              initial={settingInputValue(def, row?.value)}
              confirmed={Boolean(row?.confirmedAt)}
              history={[]}
            />
          );
        })}
      </section>
    </div>
  );
}

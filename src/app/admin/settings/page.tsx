import type { Metadata } from "next";
import Link from "next/link";

import { AdminPageHeader } from "@/components/admin/page-header";
import { SettingField } from "@/components/admin/setting-field";
import { rowHistory } from "@/lib/admin/audit";
import { requireRole } from "@/lib/auth/dal";
import { getStoredSettings } from "@/lib/settings/queries";
import { SETTINGS, SETTING_SECTIONS, settingInputValue, settingsInSection } from "@/lib/settings/registry";
import { formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Settings · Admin" };

export default async function SettingsPage() {
  await requireRole(["admin"], "/admin/settings");
  const [stored, history] = await Promise.all([getStoredSettings(), rowHistory("settings", SETTINGS.map((s) => s.key))]);

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="Settings"
        description="Each setting saves on its own and applies to the next order or request. Every change is in the audit log."
      />
      <nav aria-label="Settings sections" className="mb-6 flex flex-wrap gap-2">
        {SETTING_SECTIONS.map((section) => (
          <a key={section.id} href={`#section-${section.id}`} className="focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
            {section.title}
          </a>
        ))}
      </nav>
      <div className="space-y-6">
        {SETTING_SECTIONS.map((section) => (
          <section key={section.id} id={`section-${section.id}`} aria-labelledby={`heading-${section.id}`} className="scroll-mt-20 rounded-3xl border bg-card p-5 md:p-6">
            <h2 id={`heading-${section.id}`} className="text-xl font-bold">
              {section.title}
            </h2>
            <p className="mt-1 mb-4 text-sm text-muted-foreground">
              {section.description}
              {section.id === "rewards" ? (
                <>
                  {" "}
                  <Link href="/admin/rewards" className="font-semibold text-brand-teal-deep underline">
                    Reward tiers
                  </Link>
                </>
              ) : null}
            </p>
            {settingsInSection(section.id).map((def) => {
              const row = stored.get(def.key);
              return (
                <SettingField
                  key={`${def.key}:${row?.updatedAt ?? ""}`}
                  def={def}
                  initial={settingInputValue(def, row?.value)}
                  confirmed={Boolean(row?.confirmedAt)}
                  history={(history.get(def.key) ?? []).map((entry) => {
                    const change = entry.changes.find((c) => c.column === "value");
                    return {
                      id: entry.id,
                      at: formatCafeDateTime(new Date(entry.createdAt)),
                      who: entry.actorName ?? "An admin",
                      from: change?.from,
                      to: change?.to,
                    };
                  }).filter((h) => h.to !== undefined)}
                />
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

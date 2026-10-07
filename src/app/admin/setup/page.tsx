import { CircleCheck, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/admin/action-button";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { setConfirmedAction } from "@/lib/setup/actions";
import { getSetupChecklist, type SetupItem } from "@/lib/setup/queries";
import { formatCafeDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Setup checklist · Admin" };

export default async function SetupPage() {
  await requireRole(["admin"], "/admin/setup");
  const checklist = await getSetupChecklist();
  const groups = new Map<string, SetupItem[]>();
  for (const item of checklist.items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  const percent = Math.round((checklist.confirmed / Math.max(1, checklist.total)) * 100);

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="Setup checklist"
        description="Everything still running on a placeholder. Change it where it's edited, then mark it confirmed once the owner has signed it off."
      />
      <div className="mb-6 rounded-3xl border bg-card p-5" data-testid="setup-summary">
        <p className="font-semibold">
          <span className="tabular">{checklist.confirmed} of {checklist.total} confirmed</span>
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Setup confirmed" aria-valuemin={0} aria-valuemax={checklist.total} aria-valuenow={checklist.confirmed}>
          <div className="h-full rounded-full bg-brand-teal-deep" style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="space-y-6">
        {[...groups].map(([group, items]) => (
          <section key={group} aria-labelledby={`group-${group}`} className="rounded-3xl border bg-card p-5 md:p-6">
            <h2 id={`group-${group}`} className="text-lg font-bold">
              {group}
            </h2>
            <ul className="mt-3 divide-y">
              {items.map((item) => (
                <li key={`${item.kind}-${item.key}`} className="flex flex-wrap items-start gap-3 py-4" data-testid="setup-item" data-key={item.key}>
                  {item.confirmedAt ? (
                    <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="font-semibold">
                      {item.label}
                      <span className="sr-only">{item.confirmedAt ? " (confirmed)" : " (to confirm)"}</span>
                    </p>
                    {item.kind !== "task" ? (
                      <p className="mt-0.5 text-sm break-words">
                        <span className="text-muted-foreground">Now: </span>
                        {item.current}
                      </p>
                    ) : null}
                    {item.kind === "task" ? <p className="mt-0.5 text-sm text-muted-foreground">{item.help}</p> : null}
                    {item.confirmedAt ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Confirmed {item.confirmedBy ? `by ${item.confirmedBy} ` : ""}on {formatCafeDateTime(new Date(item.confirmedAt))}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {item.href ? (
                      <Link href={item.href} className="focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold hover:bg-muted">
                        Edit
                      </Link>
                    ) : null}
                    {item.confirmedAt ? (
                      <ActionButton size="sm" action={setConfirmedAction.bind(null, item.kind, item.key, false)}>
                        Undo
                      </ActionButton>
                    ) : (
                      <ActionButton size="sm" variant="primary" action={setConfirmedAction.bind(null, item.kind, item.key, true)} testId={`confirm-${item.key}`}>
                        Mark confirmed
                      </ActionButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

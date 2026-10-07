import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { GroupEditor } from "@/components/admin/group-editor";
import { AdminPageHeader } from "@/components/admin/page-header";
import { StatusPill } from "@/components/admin/status-pill";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { archiveGroupAction, deleteGroupAction, restoreGroupAction } from "@/lib/menu-admin/actions";
import { getAdminGroup, usageSentence } from "@/lib/menu-admin/queries";

export const metadata: Metadata = { title: "Modifier group · Admin" };

type Params = Promise<{ id: string }>;

export default async function GroupPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/menu/modifiers/${id}`);
  if (!isUuid(id)) notFound();
  const group = await getAdminGroup(id);
  if (!group) notFound();
  const past = Object.fromEntries(Object.entries(group.usage).filter(([key]) => key !== "products"));
  const usedBefore = usageSentence(past);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <AdminPageHeader
        backHref="/admin/menu/modifiers"
        backLabel="Modifiers"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {group.draft.name}
            {group.archived ? <StatusPill>Archived</StatusPill> : null}
          </span>
        }
        description={
          <Link href={`/admin/audit?table=modifier_groups&row=${id}`} className="font-semibold text-brand-teal-deep underline">
            Change history
          </Link>
        }
      />
      {group.products.length ? (
        <p className="text-sm">
          On:{" "}
          {group.products.map((p, i) => (
            <span key={p.id}>
              {i ? ", " : ""}
              <Link href={`/admin/menu/products/${p.id}`} className="font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
                {p.name}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      <GroupEditor key={JSON.stringify(group.draft)} initial={group.draft} usedOn={group.products.length} />

      <section aria-labelledby="retire-heading" className="rounded-3xl border border-destructive/30 bg-card p-5 md:p-6">
        <h2 id="retire-heading" className="text-lg font-bold">
          Archive or delete
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {group.products.length
            ? `On ${group.products.length} product(s): remove it from them before archiving or deleting.`
            : usedBefore
              ? `Used in ${usedBefore}, so it can only be archived.`
              : "Never used, so it can be deleted."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {group.archived ? (
            <ActionButton variant="primary" action={restoreGroupAction.bind(null, id)}>
              Restore
            </ActionButton>
          ) : (
            <ActionButton
              variant="danger"
              disabled={group.products.length > 0}
              action={archiveGroupAction.bind(null, id)}
              confirm={{ title: `Archive ${group.draft.name}?`, description: "It is hidden everywhere and kept for history.", confirmLabel: "Archive", tone: "danger" }}
            >
              Archive
            </ActionButton>
          )}
          <ActionButton
            variant="dangerSolid"
            disabled={group.products.length > 0 || Boolean(usedBefore)}
            action={deleteGroupAction.bind(null, id)}
            confirm={{ title: `Delete ${group.draft.name}?`, description: "It is removed for good, with its options. This can't be undone.", confirmLabel: "Delete for good", tone: "danger" }}
          >
            Delete
          </ActionButton>
        </div>
      </section>
    </div>
  );
}

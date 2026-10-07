import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionButton } from "@/components/admin/action-button";
import { AuditTrail } from "@/components/admin/form-layout";
import { AdminPageHeader } from "@/components/admin/page-header";
import { ProductEditor } from "@/components/admin/product-editor";
import { StatusPill } from "@/components/admin/status-pill";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { clientEnv } from "@/lib/env";
import { archiveProductAction, deleteProductAction, restoreProductAction } from "@/lib/menu-admin/actions";
import { getAdminProduct, listAdminCategories, listAdminGroups, usageSentence } from "@/lib/menu-admin/queries";

export const metadata: Metadata = { title: "Product · Admin" };

type Params = Promise<{ id: string }>;

export default async function ProductPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/menu/products/${id}`);
  if (!isUuid(id)) notFound();
  const [product, categories, groups] = await Promise.all([getAdminProduct(id), listAdminCategories(), listAdminGroups()]);
  if (!product) notFound();
  const used = usageSentence(product.usage);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <AdminPageHeader
        backHref="/admin/menu"
        backLabel="Menu"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {product.draft.name}
            {product.archived ? <StatusPill>Archived</StatusPill> : null}
          </span>
        }
        description={
          !product.archived && product.draft.isActive ? (
            <Link href={`/menu/${product.draft.slug}`} className="font-semibold text-brand-teal-deep underline">
              View as a customer
            </Link>
          ) : (
            "Hidden from customers."
          )
        }
      />
      <AuditTrail createdAt={product.createdAt} createdBy={null} updatedAt={product.updatedAt} updatedBy={product.updatedBy} />
      <p className="text-sm">
        <Link href={`/admin/audit?table=products&row=${id}`} className="font-semibold text-brand-teal-deep underline">
          Change history
        </Link>
      </p>

      {product.archived ? (
        <p className="rounded-2xl border bg-muted/40 p-4 text-sm">This product is archived: off the menu everywhere, kept for past orders. Restore it to edit and switch it back on.</p>
      ) : null}

      <ProductEditor key={product.updatedAt} initial={product.draft} categories={categories} groups={groups} supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL} />

      <section aria-labelledby="retire-heading" className="rounded-3xl border border-destructive/30 bg-card p-5 md:p-6">
        <h2 id="retire-heading" className="text-lg font-bold">
          Archive or delete
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {used
            ? `Used in ${used}, so it can't be deleted. Archive it instead: it leaves the menu and stays in order history.`
            : "Never used, so it can be deleted. Archiving keeps it in case it comes back."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {product.archived ? (
            <ActionButton variant="primary" action={restoreProductAction.bind(null, id)}>
              Restore
            </ActionButton>
          ) : (
            <ActionButton
              variant="danger"
              action={archiveProductAction.bind(null, id)}
              confirm={{
                title: `Archive ${product.draft.name}?`,
                description: "It disappears from the menu, carts (with a notice), event menus and favourites' add buttons. Past orders and reports keep it. You can restore it later.",
                confirmLabel: "Archive",
                tone: "danger",
              }}
            >
              Archive
            </ActionButton>
          )}
          <ActionButton
            variant="dangerSolid"
            disabled={Boolean(used)}
            action={deleteProductAction.bind(null, id)}
            confirm={{
              title: `Delete ${product.draft.name}?`,
              description: "It is removed for good, with its sizes and modifier links. This can't be undone.",
              confirmLabel: "Delete for good",
              tone: "danger",
            }}
          >
            Delete
          </ActionButton>
        </div>
      </section>
    </div>
  );
}

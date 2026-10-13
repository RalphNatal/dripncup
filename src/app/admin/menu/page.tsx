import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/admin/action-button";
import { inputClass } from "@/components/admin/form-layout";
import { MenuNav } from "@/components/admin/menu-nav";
import { AdminButtonLink, AdminPageHeader } from "@/components/admin/page-header";
import { SortableList } from "@/components/admin/sortable-list";
import { StatusPill } from "@/components/admin/status-pill";
import { requireRole } from "@/lib/auth/dal";
import { reorderProductsAction, setProductActiveAction } from "@/lib/menu-admin/actions";
import { listAdminCategories, listAdminProducts, type AdminProductRow } from "@/lib/menu-admin/queries";
import { firstParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Menu · Admin" };

function RowContent({ product }: { product: AdminProductRow }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="tabular text-sm text-muted-foreground">{product.price}</span>
      {product.archived ? <StatusPill>Archived</StatusPill> : product.isActive ? <StatusPill tone="good">On</StatusPill> : <StatusPill tone="warn">Off</StatusPill>}
      {product.limitedTime ? <StatusPill tone="info">Limited time</StatusPill> : null}
      {product.cateringEligible ? <StatusPill>Catering</StatusPill> : null}
      {!product.archived ? (
        <ActionButton size="sm" action={setProductActiveAction.bind(null, product.id, !product.isActive)}>
          {product.isActive ? "Switch off" : "Switch on"}
          <span className="sr-only"> {product.name}</span>
        </ActionButton>
      ) : null}
      <Link href={`/admin/menu/products/${product.id}`} className="focus-ring inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-brand-teal-deep hover:underline">
        Edit<span className="sr-only"> {product.name}</span>
      </Link>
    </span>
  );
}

export default async function AdminMenuPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/menu");
  const params = await searchParams;
  const q = (firstParam(params.q) ?? "").trim().toLowerCase();
  const showArchived = firstParam(params.archived) === "1";
  const [categories, products] = await Promise.all([listAdminCategories(), listAdminProducts()]);

  const visible = products.filter((p) => (showArchived ? p.archived : !p.archived) && (!q || p.name.toLowerCase().includes(q) || p.slug.includes(q)));
  const filtering = Boolean(q) || showArchived;
  const sections = [
    ...categories.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, products: visible.filter((p) => p.categoryId === c.id) })),
    { id: "none", name: "No category", isActive: true, products: visible.filter((p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId)) },
  ].filter((s) => s.products.length > 0);

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="Menu"
        description="Products by category, in menu order. Drag, or use the arrows, to reorder. Switched-off and archived items are hidden from customers."
        actions={
          <AdminButtonLink href="/admin/menu/products/new">
            <Plus className="size-4" aria-hidden="true" />
            New product
          </AdminButtonLink>
        }
      />
      <MenuNav current="/admin/menu" />

      <form method="get" role="search" className="mb-5 flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1 basis-56">
          <span className="sr-only">Search products</span>
          <input type="search" name="q" defaultValue={q} placeholder="Search products…" className={inputClass} />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} className="size-5 accent-[var(--brand-teal-deep)]" />
          Archived only
        </label>
        <button type="submit" className="focus-ring min-h-11 rounded-xl border px-4 text-sm font-semibold hover:bg-muted">
          Show
        </button>
      </form>

      {sections.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{filtering ? "No products match. Clear the search or filters to see them all." : "No products yet. Add one, or import the menu from a spreadsheet."}</p>
      ) : (
        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={`cat-${section.id}`}>
              <h2 id={`cat-${section.id}`} className="mb-2 flex items-center gap-2 text-lg font-bold">
                {section.name}
                {!section.isActive ? <StatusPill tone="warn">Category switched off</StatusPill> : null}
              </h2>
              {filtering || section.id === "none" ? (
                <ul className="divide-y rounded-2xl border bg-card">
                  {section.products.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1 text-sm font-semibold">{p.name}</span>
                      <RowContent product={p} />
                    </li>
                  ))}
                </ul>
              ) : (
                <SortableList
                  label={`${section.name} products, in menu order`}
                  items={section.products.map((p) => ({ id: p.id, label: p.name, muted: !p.isActive, content: <RowContent product={p} /> }))}
                  onSave={reorderProductsAction}
                />
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

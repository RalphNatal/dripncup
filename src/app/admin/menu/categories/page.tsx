import type { Metadata } from "next";

import { ActionButton } from "@/components/admin/action-button";
import { CategoryDialog } from "@/components/admin/category-form";
import { MenuNav } from "@/components/admin/menu-nav";
import { AdminPageHeader } from "@/components/admin/page-header";
import { SortableList } from "@/components/admin/sortable-list";
import { StatusPill } from "@/components/admin/status-pill";
import { requireRole } from "@/lib/auth/dal";
import { deleteCategoryAction, reorderCategoriesAction, saveCategoryAction } from "@/lib/menu-admin/actions";
import { listAdminCategories } from "@/lib/menu-admin/queries";

export const metadata: Metadata = { title: "Categories · Admin" };

export default async function CategoriesPage() {
  await requireRole(["admin"], "/admin/menu/categories");
  const categories = await listAdminCategories();

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        title="Categories"
        description="The menu's sections, in the order customers see them. Drag, or use the arrows, to reorder."
        actions={<CategoryDialog initial={{ id: null, name: "", slug: "", description: "", isActive: true }} />}
      />
      <MenuNav current="/admin/menu/categories" />
      {categories.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No categories yet. Add the first one with the form on this page.</p>
      ) : (
        <SortableList
          label="Categories, in menu order"
          testId="category-list"
          onSave={reorderCategoriesAction}
          items={categories.map((c) => ({
            id: c.id,
            label: c.name,
            muted: !c.isActive,
            content: (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {c.productCount} product{c.productCount === 1 ? "" : "s"}
                </span>
                {c.isActive ? <StatusPill tone="good">On</StatusPill> : <StatusPill tone="warn">Off</StatusPill>}
                <ActionButton
                  size="sm"
                  action={saveCategoryAction.bind(null, { id: c.id, name: c.name, slug: c.slug, description: c.description ?? "", isActive: !c.isActive })}
                >
                  {c.isActive ? "Switch off" : "Switch on"}
                  <span className="sr-only"> {c.name}</span>
                </ActionButton>
                <CategoryDialog initial={{ id: c.id, name: c.name, slug: c.slug, description: c.description ?? "", isActive: c.isActive }} />
                {c.productCount === 0 ? (
                  <ActionButton
                    size="sm"
                    variant="danger"
                    action={deleteCategoryAction.bind(null, c.id)}
                    confirm={{ title: `Delete ${c.name}?`, description: "It has no products. This can't be undone.", confirmLabel: "Delete", tone: "danger" }}
                  >
                    Delete<span className="sr-only"> {c.name}</span>
                  </ActionButton>
                ) : null}
              </span>
            ),
          }))}
        />
      )}
      <p className="mt-4 text-sm text-muted-foreground">A category with products can&apos;t be deleted: switch it off, or move its products first.</p>
    </div>
  );
}

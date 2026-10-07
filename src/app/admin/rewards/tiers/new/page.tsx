import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/page-header";
import { TierForm } from "@/components/admin/reward-forms";
import { requireRole } from "@/lib/auth/dal";
import { listPickerProducts } from "@/lib/events/queries";
import { listAdminCategories, listAdminGroups } from "@/lib/menu-admin/queries";

export const metadata: Metadata = { title: "New reward · Admin" };

export default async function NewTierPage() {
  await requireRole(["admin"], "/admin/rewards/tiers/new");
  const [products, categories, groups] = await Promise.all([listPickerProducts(), listAdminCategories(), listAdminGroups()]);
  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader backHref="/admin/rewards" backLabel="Rewards" title="New reward" />
      <TierForm
        products={products}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        groups={groups.filter((g) => !g.archived).map((g) => ({ id: g.id, name: g.name }))}
        initial={{
          id: null, name: "", description: "", pointsCost: "100", type: "free_item", value: "", coversModifiers: false,
          productIds: [], categoryIds: [], modifierGroupIds: [], eligibilityLabel: "", isActive: true,
        }}
      />
    </div>
  );
}

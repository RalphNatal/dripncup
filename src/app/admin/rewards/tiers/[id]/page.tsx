import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { TierForm } from "@/components/admin/reward-forms";
import { isUuid } from "@/lib/admin/guard";
import { requireRole } from "@/lib/auth/dal";
import { listPickerProducts } from "@/lib/events/queries";
import { listAdminCategories, listAdminGroups } from "@/lib/menu-admin/queries";
import { listAdminTiers } from "@/lib/rewards/admin";

export const metadata: Metadata = { title: "Reward · Admin" };

type Params = Promise<{ id: string }>;

export default async function TierPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/rewards/tiers/${id}`);
  if (!isUuid(id)) notFound();
  const [tiers, products, categories, groups] = await Promise.all([listAdminTiers(), listPickerProducts(), listAdminCategories(), listAdminGroups()]);
  const tier = tiers.find((t) => t.id === id);
  if (!tier) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader
        backHref="/admin/rewards"
        backLabel="Rewards"
        title={tier.name}
        description={
          <Link href={`/admin/audit?table=rewards&row=${id}`} className="font-semibold text-brand-teal-deep underline">
            Change history
          </Link>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">Changes apply to new checkouts; orders that already used this reward keep what they got.</p>
      <TierForm
        key={JSON.stringify(tier)}
        products={products}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        groups={groups.filter((g) => !g.archived || tier.modifierGroupIds.includes(g.id)).map((g) => ({ id: g.id, name: g.name }))}
        initial={{
          id: tier.id,
          name: tier.name,
          description: tier.description ?? "",
          pointsCost: String(tier.pointsCost),
          type: tier.type,
          value: tier.valueCents === null ? "" : (tier.valueCents / 100).toFixed(2),
          coversModifiers: tier.coversModifiers,
          productIds: [...tier.productIds],
          categoryIds: [...tier.categoryIds],
          modifierGroupIds: [...tier.modifierGroupIds],
          eligibilityLabel: tier.eligibilityLabel ?? "",
          isActive: tier.isActive,
        }}
      />
    </div>
  );
}

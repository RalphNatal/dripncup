import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/page-header";
import { PromoForm } from "@/components/admin/promo-form";
import { requireRole } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "New promo · Admin" };

export default async function NewPromoPage() {
  await requireRole(["admin"], "/admin/promos/new");
  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader backHref="/admin/promos" backLabel="Promotions" title="New promo code" />
      <PromoForm
        locked={false}
        initial={{
          id: null, code: "", description: "", type: "percent", percent: "10", amount: "", minSpend: "", maxDiscount: "",
          usageLimit: "", perUserLimit: "1", startsAt: null, endsAt: null, isActive: true,
        }}
      />
    </div>
  );
}

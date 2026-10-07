import type { Metadata } from "next";

import { AdminPageHeader } from "@/components/admin/page-header";
import { ProductEditor } from "@/components/admin/product-editor";
import { requireRole } from "@/lib/auth/dal";
import { clientEnv } from "@/lib/env";
import { listAdminCategories, listAdminGroups } from "@/lib/menu-admin/queries";
import { firstParam, type SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "New product · Admin" };

export default async function NewProductPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole(["admin"], "/admin/menu/products/new");
  const [categories, groups, params] = await Promise.all([listAdminCategories(), listAdminGroups(), searchParams]);
  const category = firstParam(params.category);

  return (
    <div className="mx-auto max-w-7xl">
      <AdminPageHeader backHref="/admin/menu" backLabel="Menu" title="New product" />
      <ProductEditor
        categories={categories}
        groups={groups}
        supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL}
        initial={{
          id: null,
          name: "",
          slug: "",
          description: "",
          categoryId: categories.find((c) => c.id === category)?.id ?? categories[0]?.id ?? null,
          imagePath: null,
          basePrice: "",
          sizes: [],
          groups: [],
          allergens: [],
          dietaryTags: [],
          calories: "",
          cateringEligible: false,
          isActive: true,
          availableFrom: null,
          availableUntil: null,
        }}
      />
    </div>
  );
}

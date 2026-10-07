import type { Metadata } from "next";

import { CollectionForm } from "@/components/admin/collection-form";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";
import { listPickerProducts } from "@/lib/events/queries";
import { addDays, cafeDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "New collection · Admin" };

export default async function NewCollectionPage() {
  await requireRole(["admin"], "/admin/collections/new");
  const [products, now] = await Promise.all([listPickerProducts(), appNow()]);

  return (
    <div className="mx-auto max-w-4xl">
      <AdminPageHeader title="New seasonal collection" backHref="/admin/collections" backLabel="Collections" />
      <CollectionForm
        collectionId={null}
        products={products}
        supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL}
        initial={{
          name: "",
          slug: "",
          description: "",
          bannerPath: null,
          accentColor: "",
          starts: { date: cafeDateKey(addDays(now, 1)), time: "00:00" },
          ends: { date: cafeDateKey(addDays(now, 31)), time: "00:00" },
          isActive: true,
          products: [],
        }}
      />
    </div>
  );
}

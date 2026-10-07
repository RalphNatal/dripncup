import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CollectionForm } from "@/components/admin/collection-form";
import { AuditTrail } from "@/components/admin/form-layout";
import { AdminPageHeader } from "@/components/admin/page-header";
import { requireRole } from "@/lib/auth/dal";
import { getAdminCollection } from "@/lib/collections/queries";
import { clientEnv } from "@/lib/env";
import { listPickerProducts } from "@/lib/events/queries";
import { cafeDateKey, cafeTimeKey } from "@/lib/time";

export const metadata: Metadata = { title: "Collection · Admin" };

type Params = Promise<{ id: string }>;

export default async function AdminCollectionPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/collections/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [collection, products] = await Promise.all([getAdminCollection(id), listPickerProducts()]);
  if (!collection) notFound();
  const starts = new Date(collection.startsAt);
  const ends = new Date(collection.endsAt);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <AdminPageHeader
        backHref="/admin/collections"
        backLabel="Collections"
        title={collection.name}
        description={
          <Link href={`/collections/${collection.slug}`} className="font-semibold text-brand-teal-deep underline">
            View as a customer
          </Link>
        }
      />
      <AuditTrail createdAt={collection.createdAt} createdBy={collection.createdByName} updatedAt={collection.updatedAt} updatedBy={collection.updatedByName} />
      <CollectionForm
        key={collection.updatedAt}
        collectionId={collection.id}
        products={products}
        supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL}
        initial={{
          name: collection.name,
          slug: collection.slug,
          description: collection.description ?? "",
          bannerPath: collection.bannerPath,
          accentColor: collection.accentColor ?? "",
          starts: { date: cafeDateKey(starts), time: cafeTimeKey(starts) },
          ends: { date: cafeDateKey(ends), time: cafeTimeKey(ends) },
          isActive: collection.isActive,
          products: collection.products,
        }}
      />
    </div>
  );
}

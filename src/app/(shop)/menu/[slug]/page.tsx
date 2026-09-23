import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductCustomizer } from "@/components/menu/product-customizer";
import { getProductPageData } from "@/lib/menu/queries";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await getProductPageData((await params).slug);
  return data ? { title: data.detail.product.name, description: data.detail.product.description ?? undefined } : {};
}

/**
 * The full-page product view, for shared links and refreshes. Opening a
 * product from the menu shows the same form as a sheet instead
 * (@modal/(.)[slug]).
 */
export default async function ProductPage({ params }: { params: Params }) {
  const data = await getProductPageData((await params).slug);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/menu"
        className="focus-ring -ml-2 mb-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Menu
      </Link>
      <ProductCustomizer
        detail={data.detail}
        location={data.location}
        ordering={data.ordering}
        layout="page"
      />
    </div>
  );
}

import { CupSoda, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { ProductCard } from "@/components/menu/product-card";
import { getCollectionPage } from "@/lib/collections/queries";
import { isLoopbackUrl } from "@/lib/menu/images";
import { formatCafeDate } from "@/lib/time";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const page = /^[a-z0-9-]{1,80}$/.test(slug) ? await getCollectionPage(slug) : null;
  return { title: page?.name ?? "Collection" };
}

/**
 * A seasonal collection: its banner and the products on the menu at the
 * selected location right now. After it ends, a friendly note and the way
 * back to the menu. Not started yet (or switched off): 404.
 */
export default async function CollectionPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const collection = await getCollectionPage(slug);
  if (!collection) notFound();
  const accent = collection.accentColor ?? "var(--brand-magenta)";

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <section
        className="relative overflow-hidden rounded-[2rem] border bg-card"
        style={{ borderColor: `color-mix(in oklab, ${accent} 35%, var(--border))` }}
        aria-labelledby="collection-title"
      >
        {collection.bannerImageUrl ? (
          <div className="relative aspect-[3/1] bg-muted">
            <Image src={collection.bannerImageUrl} alt="" fill sizes="(min-width: 768px) 768px, 100vw" className="object-cover" unoptimized={isLoopbackUrl(collection.bannerImageUrl)} />
          </div>
        ) : null}
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2" style={{ backgroundColor: accent }} />
        <div className="relative space-y-1 px-6 pt-5 pb-7">
          <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-brand-magenta-deep uppercase">
            <Sparkles className="size-4" aria-hidden="true" />
            {collection.phase === "ended" ? "Seasonal collection" : `Limited time · until ${formatCafeDate(new Date(collection.endsAt))}`}
          </p>
          <h1 id="collection-title" className="text-3xl font-extrabold">
            {collection.name}
          </h1>
          {collection.description ? <p className="text-foreground/80">{collection.description}</p> : null}
        </div>
      </section>

      {collection.phase === "ended" ? (
        <EmptyState
          icon={Sparkles}
          title="This collection has ended"
          action={
            <Link href="/menu" className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 font-semibold text-white" data-testid="collection-ended-menu-link">
              See the menu
            </Link>
          }
        >
          Mahalo to everyone who sipped along! Our full menu is waiting for you.
        </EmptyState>
      ) : collection.products.length === 0 ? (
        <EmptyState icon={CupSoda} title="Nothing from this collection here right now">
          These drinks aren&apos;t on the menu at your pickup location.{" "}
          <Link href="/menu" className="font-semibold text-brand-teal-deep underline">
            See the menu
          </Link>
          .
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" aria-label={`In the ${collection.name} collection`}>
          {collection.products.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

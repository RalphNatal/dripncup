import Link from "next/link";

import { DietaryIcons } from "@/components/menu/dietary";
import { ProductImage } from "@/components/menu/product-image";
import type { MenuProductCard } from "@/lib/menu/model";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A menu card. The whole card is clickable, but the link itself is just the
 * product name (stretched over the card), so a screen reader hears
 * "Latte, link" rather than the entire card read out as one link name.
 */
export function ProductCard({ product }: { product: MenuProductCard }) {
  return (
    <article
      className={cn(
        "group relative flex gap-3 rounded-3xl border bg-card p-3 transition-shadow hover:shadow-md",
        // Show the focus ring on the card when its link is focused.
        "has-[a:focus-visible]:ring-3 has-[a:focus-visible]:ring-brand-teal-deep/60",
        product.soldOut && "bg-muted/40",
      )}
    >
      <ProductImage
        src={product.imageUrl}
        alt=""
        seed={product.slug}
        sizes="(min-width: 768px) 8rem, 6rem"
        className={cn("size-24 shrink-0 rounded-2xl md:size-28", product.soldOut && "opacity-60 grayscale")}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <h3 className="text-lg leading-tight font-bold">
          <Link
            href={`/menu/${product.slug}`}
            scroll={false}
            className="outline-none after:absolute after:inset-0 after:rounded-3xl after:content-['']"
          >
            {product.name}
          </Link>
        </h3>
        {product.description ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-2">
          <p className="tabular text-sm font-bold">
            {product.priceVaries ? "From " : ""}
            {formatCents(product.fromPriceCents)}
          </p>
          {product.soldOut ? (
            <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-bold text-background">Sold out</span>
          ) : null}
          <DietaryIcons allergens={product.allergens} dietaryTags={product.dietaryTags} className="ml-auto" />
        </div>
      </div>
    </article>
  );
}

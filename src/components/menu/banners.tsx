import { ArrowRight, CalendarDays, CirclePause, Clock, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type { LocationView } from "@/lib/locations/storefront";
import { isLoopbackUrl } from "@/lib/menu/images";
import type { MenuCollection } from "@/lib/menu/model";

/**
 * Shown above the menu whenever the selected location cannot take orders.
 * Browsing still works; the product sheet disables Add to Cart with the same
 * explanation.
 */
export function OrderingUnavailableBanner({ location }: { location: LocationView }) {
  if (location.status.canOrder || !location.status.unavailableReason) return null;

  const Icon = location.status.kind === "paused" ? CirclePause : location.status.kind === "event" ? CalendarDays : Clock;
  const title =
    location.status.kind === "paused"
      ? "Online ordering is paused"
      : location.status.kind === "event"
        ? "Pre-orders aren't open yet"
        : "We're closed right now";

  return (
    <div role="status" className="flex gap-3 rounded-2xl border border-warning/30 bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))] p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
      <div className="text-sm">
        <p className="font-bold">{title}</p>
        <p className="mt-0.5 text-foreground/80">{location.status.unavailableReason}</p>
      </div>
    </div>
  );
}

/**
 * The current seasonal collection, on the menu and Home. The collection's own
 * accent colour (data, optional) tints the decoration only -- text always
 * stays on a light surface, so any colour the owner picks keeps AA contrast.
 * The banner artwork (the cafe's own) sits above the text, never behind it.
 */
export function CollectionBanner({ collection }: { collection: MenuCollection }) {
  const accent = collection.accentColor ?? "var(--brand-magenta)";

  return (
    <section
      aria-labelledby="collection-heading"
      className="relative overflow-hidden rounded-3xl border bg-card py-4 pl-6"
      style={{ borderColor: `color-mix(in oklab, ${accent} 35%, var(--border))` }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-2" style={{ backgroundColor: accent }} />
      {collection.bannerImageUrl ? (
        <div className="relative -mt-4 mb-3 -ml-6 aspect-[4/1] overflow-hidden">
          <Image
            src={collection.bannerImageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 960px, 100vw"
            className="object-cover"
            unoptimized={isLoopbackUrl(collection.bannerImageUrl)}
          />
        </div>
      ) : null}
      <span
        aria-hidden="true"
        className="absolute -top-10 -right-10 size-32 rounded-full opacity-15"
        style={{ backgroundColor: accent }}
      />
      <div className="relative pr-5">
        <p className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-brand-magenta-deep uppercase">
          <Sparkles className="size-4" aria-hidden="true" />
          Limited time
        </p>
        <h2 id="collection-heading" className="text-xl font-extrabold">
          {collection.name}
        </h2>
        {collection.description ? <p className="text-sm text-foreground/80">{collection.description}</p> : null}
        <Link
          href={`/collections/${collection.slug}`}
          className="focus-ring mt-1 inline-flex min-h-11 items-center gap-1 rounded text-sm font-semibold text-brand-teal-deep underline-offset-2 hover:underline"
        >
          See the collection
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {/* One swipeable row keeps the banner short on a phone. */}
      <ul
        aria-label={`In the ${collection.name} collection`}
        className="no-scrollbar relative mt-2 flex gap-2 overflow-x-auto pr-5"
      >
        {collection.products.map((product) => (
          <li key={product.slug} className="shrink-0">
            <Link
              href={`/menu/${product.slug}`}
              scroll={false}
              className="focus-ring inline-flex min-h-11 items-center rounded-full bg-muted px-4 text-sm font-semibold whitespace-nowrap hover:bg-brand-pink-soft"
            >
              {product.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

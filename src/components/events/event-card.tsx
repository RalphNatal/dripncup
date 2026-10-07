import { CalendarDays, MapPin, Navigation } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { DirectionsLink } from "@/components/locations/directions-link";
import type { PublicEvent } from "@/lib/events/queries";
import { isLoopbackUrl } from "@/lib/menu/images";
import { formatCafeDate, formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { OrderHereButton } from "./order-here-button";

/** "Sat, Oct 18 · 10:00 AM – 3:00 PM" (an end past midnight names its day). */
export function eventWindowLabel(event: Pick<PublicEvent, "startsAt" | "endsAt">): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const sameDay = formatCafeDate(start) === formatCafeDate(end);
  return `${formatCafeDate(start)} · ${formatCafeTimeOfDay(start)} – ${sameDay ? "" : `${formatCafeDate(end)} `}${formatCafeTimeOfDay(end)}`;
}

/** The admin's map link if they gave one, else Google/Apple Maps for the address. */
export function EventDirections({ event }: { event: Pick<PublicEvent, "mapUrl" | "directionsQuery"> }) {
  if (event.mapUrl) {
    return (
      <a
        href={event.mapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-teal-deep/30 px-4 text-sm font-semibold text-brand-teal-deep hover:bg-brand-teal-soft"
      >
        <Navigation className="size-4" aria-hidden="true" />
        Get Directions
        <span className="sr-only">(opens a map in a new tab)</span>
      </a>
    );
  }
  return <DirectionsLink destination={event.directionsQuery} />;
}

export function EventCard({ event, compact = false }: { event: PublicEvent; compact?: boolean }) {
  const preview = event.menu.slice(0, compact ? 3 : 5);
  const more = event.menu.length - preview.length;

  return (
    <article className="overflow-hidden rounded-3xl border bg-card" data-testid="event-card" aria-labelledby={`event-${event.id}`}>
      {event.imageUrl && !compact ? (
        <div className="relative aspect-[3/1] bg-muted">
          <Image src={event.imageUrl} alt="" fill sizes="(min-width: 768px) 640px, 100vw" className="object-cover" unoptimized={isLoopbackUrl(event.imageUrl)} />
        </div>
      ) : null}
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 id={`event-${event.id}`} className="text-lg font-bold">
            <Link href={`/events/${event.slug}`} className="focus-ring rounded hover:underline">
              {event.name}
            </Link>
          </h3>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-bold",
              event.phase === "live" ? "bg-brand-teal-deep text-white" : "bg-brand-pink-soft text-brand-magenta-deep",
            )}
          >
            {event.phase === "live" ? "Open now" : event.phase === "past" ? "Ended" : "Coming up"}
          </span>
        </div>
        <ul className="space-y-1 text-sm">
          <li className="flex items-center gap-2">
            <CalendarDays className="size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
            {eventWindowLabel(event)}
          </li>
          {event.addressLines.length > 0 ? (
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
              {event.addressLines.join(", ")}
            </li>
          ) : null}
        </ul>
        {preview.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">On the menu:</span> {preview.map((p) => p.name).join(", ")}
            {more > 0 ? ` and ${more} more` : ""}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {event.phase === "live" ? <OrderHereButton locationId={event.id} name={event.name} /> : null}
          <EventDirections event={event} />
        </div>
        {event.phase === "upcoming" ? (
          <p className="text-xs text-muted-foreground">Pre-orders open when the pop-up does.</p>
        ) : null}
      </div>
    </article>
  );
}

import { CalendarDays, Info, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventDirections, eventWindowLabel } from "@/components/events/event-card";
import { OrderHereButton } from "@/components/events/order-here-button";
import { PageShell } from "@/components/page-shell";
import { getPublicEvent } from "@/lib/events/queries";
import { isLoopbackUrl } from "@/lib/menu/images";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const event = /^[a-z0-9-]{1,80}$/.test(slug) ? await getPublicEvent(slug) : null;
  return { title: event?.name ?? "Pop-up event" };
}

/** One published pop-up. A past one says so; an unpublished one is a 404. */
export default async function EventPage({ params }: { params: Params }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) notFound();
  const event = await getPublicEvent(slug);
  if (!event) notFound();

  return (
    <PageShell title={event.name} backHref="/events" backLabel="Pop-up events">
      <div className="space-y-5">
        {event.imageUrl ? (
          <div className="relative aspect-[3/1] overflow-hidden rounded-3xl bg-muted">
            <Image src={event.imageUrl} alt="" fill sizes="(min-width: 768px) 448px, 100vw" className="object-cover" unoptimized={isLoopbackUrl(event.imageUrl)} />
          </div>
        ) : null}

        {event.phase === "past" ? (
          <p className="rounded-2xl bg-muted p-4 text-sm font-medium" role="status">
            This pop-up has ended. Mahalo to everyone who came by!{" "}
            <Link href="/events" className="font-semibold text-brand-teal-deep underline">
              See what&apos;s coming up
            </Link>
            .
          </p>
        ) : null}

        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <CalendarDays className="size-4 text-brand-teal-deep" aria-hidden="true" />
            {eventWindowLabel(event)} (Honolulu time)
          </li>
          {event.addressLines.length > 0 ? (
            <li className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-4 text-brand-teal-deep" aria-hidden="true" />
              {event.addressLines.join(", ")}
            </li>
          ) : null}
          {event.pickupInstructions ? (
            <li className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 text-brand-teal-deep" aria-hidden="true" />
              {event.pickupInstructions}
            </li>
          ) : null}
        </ul>

        {event.description ? <p>{event.description}</p> : null}

        <div className="flex flex-wrap gap-2">
          {event.phase === "live" ? <OrderHereButton locationId={event.id} name={event.name} /> : null}
          <EventDirections event={event} />
        </div>
        {event.phase === "upcoming" ? <p className="text-sm text-muted-foreground">Pre-orders open when the pop-up does.</p> : null}

        {event.menu.length > 0 ? (
          <section aria-labelledby="event-menu" className="rounded-3xl border bg-card p-5">
            <h2 id="event-menu" className="text-lg font-bold">
              On the menu
            </h2>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {event.menu.map((item) => (
                <li key={item.slug}>{item.name}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}

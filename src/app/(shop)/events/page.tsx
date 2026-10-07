import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { EventCard } from "@/components/events/event-card";
import { listPublicEvents } from "@/lib/events/queries";

export const metadata: Metadata = {
  title: "Pop-up events",
  description: "Where to find Drincup Cafe pop-ups around Oʻahu, and pre-order for pickup at the booth.",
};

/** Live and upcoming pop-ups. Never past or unpublished ones (RLS and the query both refuse). */
export default async function EventsPage() {
  const events = await listPublicEvents();
  const live = events.filter((e) => e.phase === "live");
  const upcoming = events.filter((e) => e.phase === "upcoming");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Pop-up events</h1>
        <p className="text-sm text-muted-foreground">Find us around the island. Pre-order while a pop-up is open and pick up at the booth.</p>
      </div>

      {events.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No pop-ups scheduled right now">
          Check back soon, or come see us at the cafe on Kapiolani Blvd.
        </EmptyState>
      ) : null}

      {live.length > 0 ? (
        <section aria-labelledby="events-live" className="space-y-3">
          <h2 id="events-live" className="text-xl font-bold">
            Open now
          </h2>
          {live.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section aria-labelledby="events-upcoming" className="space-y-3">
          <h2 id="events-upcoming" className="text-xl font-bold">
            Coming up
          </h2>
          {upcoming.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

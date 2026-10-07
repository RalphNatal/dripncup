import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventControls } from "@/components/admin/event-controls";
import { EventForm } from "@/components/admin/event-form";
import { AuditTrail } from "@/components/admin/form-layout";
import { AdminPageHeader } from "@/components/admin/page-header";
import { eventWindowLabel } from "@/components/events/event-card";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";
import { getAdminEvent, listPickerProducts, listStaffProfiles } from "@/lib/events/queries";
import { eventPhase } from "@/lib/events/window";
import { addDays, cafeDateKey, cafeTimeKey } from "@/lib/time";

export const metadata: Metadata = { title: "Event · Admin" };

type Params = Promise<{ id: string }>;

export default async function AdminEventPage({ params }: { params: Params }) {
  const { id } = await params;
  await requireRole(["admin"], `/admin/events/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [event, products, staff, now] = await Promise.all([getAdminEvent(id), listPickerProducts(), listStaffProfiles(), appNow()]);
  if (!event) notFound();

  const starts = new Date(event.startsAt);
  const phase = eventPhase(event, now);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <AdminPageHeader
        backHref="/admin/events"
        backLabel="Events"
        title={event.name}
        description={
          <>
            {eventWindowLabel(event)} · {phase === "live" ? "Live now" : phase === "past" ? "Past" : "Upcoming"} ·{" "}
            <span data-testid="event-publish-state">{event.isPublished ? "Published" : "Draft (not visible to customers)"}</span>
            {event.isPublished ? (
              <>
                {" · "}
                <Link href={`/events/${event.slug}`} className="font-semibold text-brand-teal-deep underline">
                  View as a customer
                </Link>
              </>
            ) : null}
          </>
        }
        actions={<EventControls eventId={event.id} isPublished={event.isPublished} menuCount={event.menu.length} suggestedDate={cafeDateKey(addDays(starts, 7))} />}
      />
      <AuditTrail createdAt={event.createdAt} createdBy={event.createdByName} updatedAt={event.updatedAt} updatedBy={event.updatedByName} />
      <EventForm
        key={event.updatedAt}
        event={event}
        products={products}
        staff={staff}
        supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL}
        initial={{
          name: event.name,
          slug: event.slug,
          description: event.description ?? "",
          addressLine1: event.addressLine1 ?? "",
          addressLine2: event.addressLine2 ?? "",
          city: event.city,
          postalCode: event.postalCode ?? "",
          mapUrl: event.mapUrl ?? "",
          latitude: event.latitude === null ? "" : String(event.latitude),
          longitude: event.longitude === null ? "" : String(event.longitude),
          date: cafeDateKey(starts),
          startTime: cafeTimeKey(starts),
          endTime: cafeTimeKey(new Date(event.endsAt)),
          prepTimeMinutes: String(event.prepTimeMinutes),
          imagePath: event.imagePath,
          pickupInstructions: event.pickupInstructions ?? "",
          menu: event.menu,
          staff: event.staff,
        }}
      />
    </div>
  );
}

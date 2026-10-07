import type { Metadata } from "next";
import Link from "next/link";

import { ActionButton } from "@/components/admin/action-button";
import { AdminPageHeader } from "@/components/admin/page-header";
import { CafeForm, ClosureDialog, HoursEditor, PauseControl } from "@/components/admin/location-forms";
import { StatusPill } from "@/components/admin/status-pill";
import { requireRole } from "@/lib/auth/dal";
import { appNow } from "@/lib/clock";
import { clientEnv } from "@/lib/env";
import { getAdminLocations } from "@/lib/locations/admin";
import { deleteClosureAction } from "@/lib/locations/admin-actions";
import { isAcceptingOrders } from "@/lib/locations/status";
import { storeAlwaysOpen } from "@/lib/test-mode";
import { formatCafeDateLong, formatCafeDateTime, formatCafeTimeOfDay, formatTimeString } from "@/lib/time";

export const metadata: Metadata = { title: "Locations · Admin" };

export default async function LocationsPage() {
  await requireRole(["admin"], "/admin/locations");
  const now = await appNow();
  const { cafes, hours, closures, events } = await getAdminLocations(now);
  const cafe = cafes[0];
  if (!cafe) {
    return <p className="rounded-2xl border border-dashed p-8 text-center text-sm">No cafe is set up. Run the seed (README).</p>;
  }
  const paused = !isAcceptingOrders(cafe.acceptingOrders, cafe.pausedUntil, now);
  const locationNames = [...cafes.map((c) => ({ id: c.id, name: c.name }))];

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <AdminPageHeader title="Locations" description="The cafe's details, hours and closures. Pop-up events have their own page." />
      {storeAlwaysOpen() ? (
        <p className="rounded-2xl border border-warning/40 p-4 text-sm" role="status">
          Local test mode is on (TEST_STORE_ALWAYS_OPEN): this development server ignores the hours and closures below. They are still saved, and apply everywhere else.
        </p>
      ) : null}

      <section id="pause" aria-labelledby="pause-heading" className="scroll-mt-20 rounded-3xl border bg-card p-5 md:p-6">
        <h2 id="pause-heading" className="flex flex-wrap items-center gap-2 text-xl font-bold">
          Online ordering at {cafe.name}
          {paused ? <StatusPill tone="warn">Paused</StatusPill> : <StatusPill tone="good">Taking orders</StatusPill>}
        </h2>
        <div className="mt-3">
          <PauseControl
            locationId={cafe.id}
            name={cafe.name}
            paused={paused}
            until={paused && cafe.pausedUntil ? formatCafeTimeOfDay(new Date(cafe.pausedUntil)) : null}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          To stop online orders everywhere for longer, use Online ordering in{" "}
          <Link href="/admin/settings#orders.accepting_online_orders" className="font-semibold text-brand-teal-deep underline">
            Settings
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="hours-heading" className="space-y-3">
        <h2 id="hours-heading" className="text-xl font-bold">
          Weekly hours
        </h2>
        <HoursEditor key={JSON.stringify(hours)} locationId={cafe.id} initial={hours} />
      </section>

      <section aria-labelledby="closures-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="closures-heading" className="text-xl font-bold">
            Closures and holiday hours
          </h2>
          <ClosureDialog
            label="Add closure"
            locations={locationNames}
            initial={{ id: null, locationId: cafe.id, date: "", isClosed: true, opensAt: "09:00", closesAt: "14:00", reason: "" }}
          />
        </div>
        {closures.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">No closures coming up.</p>
        ) : (
          <ul className="divide-y rounded-3xl border bg-card" data-testid="closure-list">
            {closures.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{formatCafeDateLong(new Date(`${c.date}T12:00:00-10:00`))}</span>
                  <span className="block text-sm text-muted-foreground">
                    {c.isClosed ? "Closed all day" : `Open ${formatTimeString(c.opensAt!)} – ${formatTimeString(c.closesAt!)}`}
                    {c.locationId ? "" : " · every location"}
                    {c.reason ? ` · ${c.reason}` : ""}
                  </span>
                </span>
                <ClosureDialog
                  label="Edit"
                  locations={locationNames}
                  initial={{ id: c.id, locationId: c.locationId, date: c.date, isClosed: c.isClosed, opensAt: c.opensAt ?? "09:00", closesAt: c.closesAt ?? "14:00", reason: c.reason ?? "" }}
                />
                <ActionButton
                  size="sm"
                  variant="danger"
                  action={deleteClosureAction.bind(null, c.id)}
                  confirm={{ title: "Remove this closure?", description: "The usual hours apply that day again.", confirmLabel: "Remove", tone: "danger" }}
                >
                  Remove
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cafe-heading" className="space-y-3">
        <h2 id="cafe-heading" className="text-xl font-bold">
          Cafe details
        </h2>
        <CafeForm
          key={`${cafe.name}${cafe.prepTimeMinutes}${cafe.pickupInstructions}`}
          supabaseUrl={clientEnv.NEXT_PUBLIC_SUPABASE_URL}
          initial={{
            id: cafe.id,
            name: cafe.name,
            description: cafe.description,
            addressLine1: cafe.addressLine1,
            addressLine2: cafe.addressLine2,
            city: cafe.city,
            state: cafe.state,
            postalCode: cafe.postalCode,
            phone: cafe.phone,
            mapUrl: cafe.mapUrl,
            latitude: cafe.latitude,
            longitude: cafe.longitude,
            pickupInstructions: cafe.pickupInstructions,
            prepTimeMinutes: String(cafe.prepTimeMinutes),
            imagePath: cafe.imagePath,
          }}
        />
      </section>

      <section aria-labelledby="events-heading" className="rounded-3xl border bg-card p-5">
        <h2 id="events-heading" className="text-xl font-bold">
          Pop-up events
        </h2>
        {events.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/admin/events/${e.id}`} className="font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
                  {e.name}
                </Link>{" "}
                <span className="text-muted-foreground">· {formatCafeDateTime(new Date(e.startsAt))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">None coming up.</p>
        )}
        <Link href="/admin/events" className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand-teal-deep underline">
          Manage events
        </Link>
      </section>
    </div>
  );
}

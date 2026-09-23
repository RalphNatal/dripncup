"use client";

/**
 * The header's "Pickup at ..." button and the sheet it opens: every location
 * the customer can order from, with live status, today's hours, prep time,
 * pickup instructions and directions.
 */
import { CalendarDays, Check, ChevronDown, Clock, MapPin, Timer } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { DirectionsLink } from "@/components/locations/directions-link";
import { StatusDot } from "@/components/locations/status-dot";
import {
  SheetDialog,
  SheetDialogContent,
  SheetDialogDescription,
  SheetDialogTitle,
  SheetDialogTrigger,
} from "@/components/shell/sheet-dialog";
import { useCartStore } from "@/lib/cart/store";
import { selectLocation } from "@/lib/locations/actions";
import type { LocationView } from "@/lib/locations/storefront";
import { cn } from "@/lib/utils";

export function LocationPicker({ locations, selected }: { locations: LocationView[]; selected: LocationView | null }) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function choose(location: LocationView) {
    setPendingId(location.id);
    startTransition(async () => {
      const result = await selectLocation(location.id);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      // Keeps the cart, flagged for re-checking if it was built elsewhere.
      useCartStore.getState().syncLocation(result.locationId);
      setOpen(false);
      toast.success(`Ordering from ${location.name}`);
    });
  }

  if (!selected) {
    return <p className="text-sm text-muted-foreground">Ordering opens soon.</p>;
  }

  return (
    <SheetDialog open={open} onOpenChange={setOpen}>
      <SheetDialogTrigger asChild>
        <button
          type="button"
          className="focus-ring group flex min-h-11 w-full min-w-0 items-center gap-2 rounded-full px-2 text-left hover:bg-muted md:w-auto md:max-w-sm md:border md:px-3"
        >
          <MapPin className="size-4 shrink-0 text-brand-teal-deep" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="sr-only">Pickup location: </span>
            <span className="block truncate text-sm leading-tight font-semibold">{selected.name}</span>
            <span className="flex items-center gap-1.5 text-xs leading-tight text-muted-foreground">
              <StatusDot kind={selected.status.kind} />
              <span className="truncate">
                {selected.status.label}
                {selected.status.detail && selected.status.kind === "open" ? ` · ${selected.status.detail}` : ""}
              </span>
            </span>
          </span>
          <span className="sr-only">. Change</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </SheetDialogTrigger>

      <SheetDialogContent aria-describedby="location-sheet-description">
        <div className="px-5 pt-4 pb-2 pr-16">
          <SheetDialogTitle className="text-2xl font-extrabold">Pickup location</SheetDialogTitle>
          <SheetDialogDescription id="location-sheet-description" className="text-sm text-muted-foreground">
            Your menu, prices and pickup time follow the location you choose.
          </SheetDialogDescription>
        </div>

        <ul className="flex-1 space-y-3 overflow-y-auto px-5 pt-2 pb-6">
          {locations.map((location) => {
            const isSelected = location.id === selected.id;
            return (
              <li key={location.id}>
                <article
                  aria-labelledby={`location-${location.id}-name`}
                  className={cn(
                    "rounded-2xl border bg-card p-4",
                    isSelected && "border-brand-teal-deep ring-1 ring-brand-teal-deep",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 id={`location-${location.id}-name`} className="text-lg leading-tight font-bold">
                        {location.name}
                      </h3>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                        <StatusDot kind={location.status.kind} />
                        {location.status.label}
                      </p>
                    </div>
                    {location.type === "event" ? (
                      <span className="shrink-0 rounded-full bg-brand-pink-soft px-2.5 py-1 text-xs font-bold text-accent-foreground">
                        Pop-up
                      </span>
                    ) : null}
                  </div>

                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex gap-2">
                      <dt className="shrink-0">
                        {location.type === "event" ? (
                          <CalendarDays className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <Clock className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span className="sr-only">{location.type === "event" ? "When" : "Today's hours"}</span>
                      </dt>
                      <dd>
                        {location.type === "event" ? location.todaysHours.hours : `Today: ${location.todaysHours.hours}`}
                        {location.todaysHours.note ? (
                          <span className="block text-muted-foreground">{location.todaysHours.note}</span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0">
                        <Timer className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                        <span className="sr-only">Estimated prep time</span>
                      </dt>
                      <dd>Ready in about {location.prepTimeMinutes} min</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0">
                        <MapPin className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
                        <span className="sr-only">Address</span>
                      </dt>
                      <dd>
                        <address className="not-italic">{location.addressLines.join(", ")}</address>
                      </dd>
                    </div>
                  </dl>

                  {location.pickupInstructions ? (
                    <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm">
                      <span className="font-semibold">Pickup: </span>
                      {location.pickupInstructions}
                    </p>
                  ) : null}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {isSelected ? (
                      <p className="inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-brand-teal-deep">
                        <Check className="size-4" aria-hidden="true" />
                        Your pickup location
                      </p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => choose(location)}
                        disabled={pendingId !== null}
                        className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
                      >
                        {pendingId === location.id ? "Switching…" : "Pick up here"}
                        <span className="sr-only"> at {location.name}</span>
                      </button>
                    )}
                    <DirectionsLink destination={location.directionsQuery} />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </SheetDialogContent>
    </SheetDialog>
  );
}

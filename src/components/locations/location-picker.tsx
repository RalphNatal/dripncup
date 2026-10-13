"use client";

/**
 * The header's "Pickup at ..." button. It opens the location sheet
 * (location-sheet.tsx), whose dialog code loads the first time it is wanted
 * (on hover or focus, so it is ready by the tap), not with every page.
 */
import { ChevronDown, MapPin } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";

import { StatusDot } from "@/components/locations/status-dot";
import type { LocationView } from "@/lib/locations/storefront";

const loadSheet = () => import("./location-sheet");
const LocationSheet = dynamic(loadSheet, { ssr: false });

export function LocationPicker({ locations, selected }: { locations: LocationView[]; selected: LocationView | null }) {
  const [open, setOpen] = useState(false);
  // Once opened, the sheet stays mounted so it can animate closed.
  const [wanted, setWanted] = useState(false);

  if (!selected) {
    return <p className="text-sm text-muted-foreground">Ordering opens soon.</p>;
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => void loadSheet()}
        onFocus={() => void loadSheet()}
        onClick={() => {
          setWanted(true);
          setOpen(true);
        }}
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
      {wanted ? <LocationSheet locations={locations} selected={selected} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

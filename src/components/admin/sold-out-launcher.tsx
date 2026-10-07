"use client";

/**
 * Opens the staff dashboard's sold-out panel for one location, so the admin
 * marks things sold out exactly as the counter does (set_sold_out(), with
 * the same "until end of day" reset).
 */
import { CircleSlash } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SoldOutPanel } from "@/components/staff/sold-out-panel";
import type { Closure, WeeklyHours } from "@/lib/locations/status";

export function SoldOutLauncher({ location }: { location: { id: string; name: string; type: "cafe" | "event"; hours: WeeklyHours[]; closures: Closure[] } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white"
      >
        <CircleSlash className="size-4" aria-hidden="true" />
        Mark sold out<span className="sr-only"> at {location.name}</span>
      </button>
      <SoldOutPanel
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) router.refresh();
        }}
        location={location}
      />
    </>
  );
}

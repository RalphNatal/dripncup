"use client";

import { Navigation } from "lucide-react";
import { useSyncExternalStore } from "react";

import { directionsUrls, isAppleMobile } from "@/lib/locations/directions";
import { cn } from "@/lib/utils";

const noSubscription = () => () => {};

/**
 * "Get Directions": Apple Maps on iPhone / iPad, Google Maps elsewhere.
 * The server (and the first client render) use Google; iOS switches after
 * hydration, so the markup never mismatches.
 */
export function DirectionsLink({ destination, className }: { destination: string; className?: string }) {
  const apple = useSyncExternalStore(
    noSubscription,
    () => isAppleMobile(navigator.userAgent, navigator.maxTouchPoints),
    () => false,
  );
  const urls = directionsUrls(destination);

  return (
    <a
      href={apple ? urls.apple : urls.google}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "focus-ring inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-teal-deep/30 px-4 text-sm font-semibold text-brand-teal-deep hover:bg-brand-teal-soft",
        className,
      )}
    >
      <Navigation className="size-4" aria-hidden="true" />
      Get Directions
      <span className="sr-only">(opens {apple ? "Apple Maps" : "Google Maps"} in a new tab)</span>
    </a>
  );
}

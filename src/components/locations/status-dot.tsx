import type { LocationView } from "@/lib/locations/storefront";
import { cn } from "@/lib/utils";

const DOT: Record<LocationView["status"]["kind"], string> = {
  open: "bg-success",
  paused: "bg-warning",
  closed: "bg-muted-foreground",
  event: "bg-brand-magenta-deep",
};

/** Colour cue next to a status label. Decorative: the label carries the meaning. */
export function StatusDot({ kind, className }: { kind: LocationView["status"]["kind"]; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", DOT[kind], className)} />;
}

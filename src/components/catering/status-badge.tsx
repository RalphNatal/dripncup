import { CATERING_STATUS_LABELS, type CateringStatus } from "@/lib/catering/status";
import { cn } from "@/lib/utils";

/** Colour plus words, never colour alone. All pairs clear AA. */
const TONES: Record<CateringStatus, string> = {
  submitted: "bg-muted text-foreground",
  quoted: "bg-brand-pink-soft text-brand-magenta-deep",
  confirmed: "bg-brand-teal-soft text-brand-teal-deep",
  fulfilled: "bg-brand-teal-deep text-white",
  cancelled: "bg-muted text-muted-foreground line-through decoration-1",
};

export function CateringStatusBadge({ status, className }: { status: CateringStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap", TONES[status], className)}>
      {CATERING_STATUS_LABELS[status]}
    </span>
  );
}

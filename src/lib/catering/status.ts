/**
 * The catering lifecycle, mirrored from the database.
 *
 * `is_valid_catering_transition()` (supabase/migrations/…_catering_workflow.sql)
 * is the enforcing copy; this one lets the UI offer only the actions that can
 * work. A unit test parses the migration and fails if the two differ.
 *
 *   submitted -> quoted -> confirmed -> fulfilled
 *       ^          |
 *       └──────────┘  (the customer asks for changes)
 *   cancelled from submitted, quoted or confirmed
 */
import type { Enums } from "@/types/database";

export type CateringStatus = Enums<"catering_status">;

export const CATERING_TRANSITIONS: Record<CateringStatus, readonly CateringStatus[]> = {
  submitted: ["quoted", "cancelled"],
  quoted: ["submitted", "confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

export function isValidCateringTransition(from: CateringStatus, to: CateringStatus): boolean {
  return CATERING_TRANSITIONS[from].includes(to);
}

export const CATERING_STATUS_LABELS: Record<CateringStatus, string> = {
  submitted: "Submitted",
  quoted: "Quote ready",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

/** What the customer should know about each state, in one sentence. */
export const CATERING_STATUS_HINTS: Record<CateringStatus, string> = {
  submitted: "We're preparing your quote.",
  quoted: "Your quote is ready to review.",
  confirmed: "Paid and confirmed. We'll see you on the day!",
  fulfilled: "All done. Mahalo for having us!",
  cancelled: "This request was cancelled.",
};

export const CATERING_STATUSES = Object.keys(CATERING_TRANSITIONS) as CateringStatus[];

/** The customer-facing steps, for a progress indicator. -1 for cancelled. */
export function cateringProgressIndex(status: CateringStatus): number {
  return ["submitted", "quoted", "confirmed", "fulfilled"].indexOf(status);
}

/**
 * Catering's time and place rules, pure (no I/O; `now` passed in) so the
 * request form, the server actions and the tests agree. The database
 * enforces the same rules (the lead-time trigger, catering_payable_quote,
 * catering_issue_quote); these give the customer a clear answer first.
 */

export interface CateringRuleSettings {
  /** catering.min_lead_time_hours (72) */
  minLeadTimeHours: number;
  /** catering.payment_deadline_hours (48, NEEDS_CONFIRMATION) */
  paymentDeadlineHours: number;
  /** catering.quote_valid_days (7, NEEDS_CONFIRMATION) */
  quoteValidDays: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const QUARTER_HOUR = 15 * 60 * 1000;

/**
 * The earliest event time the form offers: now + the lead time, rounded up
 * to the next quarter hour (the picker's step), so the first choice shown is
 * one the database accepts.
 */
export function earliestEventAt(now: Date, leadTimeHours: number): Date {
  const earliest = now.getTime() + leadTimeHours * HOUR;
  return new Date(Math.ceil(earliest / QUARTER_HOUR) * QUARTER_HOUR);
}

/** True when `eventAt` is too soon to request (the trigger's rule: event_at < now + lead time). */
export function isInsideLeadTime(eventAt: Date, now: Date, leadTimeHours: number): boolean {
  return eventAt.getTime() < now.getTime() + leadTimeHours * HOUR;
}

/** The last moment a quote for this event can be paid. */
export function paymentDeadline(eventAt: Date, deadlineHours: number): Date {
  return new Date(eventAt.getTime() - deadlineHours * HOUR);
}

/**
 * A new quote's default expiry: `quoteValidDays` from now, but never later
 * than the payment deadline. Null when the deadline has already passed, in
 * which case the quote cannot be issued.
 */
export function defaultQuoteExpiry(now: Date, eventAt: Date, settings: Pick<CateringRuleSettings, "paymentDeadlineHours" | "quoteValidDays">): Date | null {
  const deadline = paymentDeadline(eventAt, settings.paymentDeadlineHours);
  if (deadline.getTime() <= now.getTime()) return null;
  return new Date(Math.min(now.getTime() + settings.quoteValidDays * DAY, deadline.getTime()));
}

export type QuotePayability =
  | { payable: true }
  | { payable: false; reason: "not_quoted" | "not_current" | "expired" | "past_deadline"; message: string };

/** Why a quote can or cannot be paid now. Mirrors catering_payable_quote(). */
export function quotePayability(input: {
  requestStatus: string;
  quote: { id: string; status: string; expiresAt: Date; paymentDeadlineAt: Date };
  currentQuoteId: string | null;
  now: Date;
}): QuotePayability {
  const { quote, now } = input;
  if (input.requestStatus !== "quoted") {
    return { payable: false, reason: "not_quoted", message: "This request isn't waiting for payment." };
  }
  if (quote.status !== "active" || input.currentQuoteId !== quote.id) {
    return { payable: false, reason: "not_current", message: "This quote has been replaced. Please review the latest one." };
  }
  if (now.getTime() >= quote.paymentDeadlineAt.getTime()) {
    return {
      payable: false,
      reason: "past_deadline",
      message: "It's too close to your event to pay online. Please contact us and we'll sort it out.",
    };
  }
  if (now.getTime() >= quote.expiresAt.getTime()) {
    return {
      payable: false,
      reason: "expired",
      message: "This quote has expired. Ask us for a new one and we'll reissue it.",
    };
  }
  return { payable: true };
}

/** A 5-digit ZIP from "96814" or "96814-1234"; null if it is not one. */
export function normalizeZip(value: string): string | null {
  const match = value.trim().match(/^(\d{5})(?:-\d{4})?$/);
  return match ? match[1] : null;
}

export type DeliveryAreaCheck =
  | { ok: true; zip: string }
  | { ok: false; reason: "not_offered" | "invalid_zip" | "outside_area"; message: string };

/** Whether catering can deliver to this ZIP (settings catering.delivery_offered / delivery_zip_codes). */
export function checkDeliveryArea(zipInput: string, settings: { deliveryOffered: boolean; zipCodes: readonly string[] }): DeliveryAreaCheck {
  if (!settings.deliveryOffered) {
    return { ok: false, reason: "not_offered", message: "Delivery isn't available right now. Please choose pickup at the cafe." };
  }
  const zip = normalizeZip(zipInput);
  if (!zip) return { ok: false, reason: "invalid_zip", message: "Enter a 5-digit ZIP code." };
  if (!settings.zipCodes.includes(zip)) {
    return {
      ok: false,
      reason: "outside_area",
      message: `Sorry, we don't deliver to ${zip} yet. We deliver across Oʻahu's listed ZIP codes; choose pickup at the cafe, or contact us about your event.`,
    };
  }
  return { ok: true, zip };
}

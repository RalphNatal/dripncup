/**
 * Pickup times: the ASAP estimate and the 15-minute scheduled slots.
 *
 * Pure -- `now`, hours, closures, queue length and slot bookings are passed
 * in -- so the rules are unit-tested at exact instants, and the same code
 * runs when the checkout page loads, when the order is created, and when the
 * payment webhook re-checks the order. All times are Pacific/Honolulu.
 *
 * Rules:
 *   ASAP        ready = now + prep time + (minutes per queued order x queue),
 *               rounded up to 5 minutes. Only while the location is open, and
 *               only if that is before it closes.
 *   Scheduled   15-minute slots, today only. The first is at least the prep
 *               time from now; the last starts `lastSlotBufferMinutes` before
 *               closing. If the location is closed right now, the slots are
 *               the next open day's. Open through midnight (24-hour days,
 *               local test mode): slots carry on past midnight, up to
 *               OVERNIGHT_SLOT_HOURS ahead. Pop-ups: only inside the event
 *               window. A slot with `maxOrdersPerSlot` orders already is full.
 *   Paused, the global switch off, or a pop-up outside its window: no pickup
 *   times at all -- checkout is blocked.
 */
import {
  getLocationStatus,
  nextOpening,
  openIntervalsOn,
  openStretchEnd,
  type Closure,
  type StatusLocation,
  type WeeklyHours,
} from "@/lib/locations/status";
import { addMinutes, cafeDateKey, ceilToSlot } from "@/lib/time";

export interface PickupSettings {
  slotMinutes: number;
  lastSlotBufferMinutes: number;
  /** Null or 0 = no limit. */
  maxOrdersPerSlot: number | null;
  queueMinutesPerOrder: number;
}

export interface PickupContext {
  location: StatusLocation & { name: string; prepTimeMinutes: number };
  hours: readonly WeeklyHours[];
  closures: readonly Closure[];
  onlineOrderingEnabled: boolean;
  now: Date;
  settings: PickupSettings;
  /** Orders placed, accepted or preparing at this location right now. */
  activeQueueCount: number;
  /** Slot start (ISO) -> orders already booked for it. */
  slotBookings: Readonly<Record<string, number>>;
}

export interface PickupSlot {
  /** ISO instant of the slot start. */
  startsAt: string;
  available: boolean;
}

/** Plain data, so it can go straight to the checkout page. */
export interface PickupOptions {
  canCheckout: boolean;
  blockedReason: string | null;
  asap: { available: boolean; readyAt: string | null; unavailableReason: string | null };
  /** The Honolulu date the slots are on ("2026-09-24"), or null when there are none. */
  slotDate: string | null;
  slots: PickupSlot[];
}

export type PickupChoice = { type: "asap" } | { type: "scheduled"; slot: string };

export interface ResolvedPickup {
  pickupType: "asap" | "scheduled";
  scheduledFor: Date | null;
  estimatedReadyAt: Date;
}

const FIVE_MINUTES = 5 * 60_000;

/** How far ahead slots run when a location stays open through midnight. */
export const OVERNIGHT_SLOT_HOURS = 12;

/** "Ready around 9:40 AM": prep plus the queue, rounded up to 5 minutes. */
export function estimateAsapReadyAt(
  now: Date,
  prepTimeMinutes: number,
  activeQueueCount: number,
  queueMinutesPerOrder: number,
): Date {
  const minutes = prepTimeMinutes + Math.max(0, activeQueueCount) * queueMinutesPerOrder;
  const ready = addMinutes(now, minutes);
  return new Date(Math.ceil(ready.getTime() / FIVE_MINUTES) * FIVE_MINUTES);
}

function blocked(reason: string): PickupOptions {
  return {
    canCheckout: false,
    blockedReason: reason,
    asap: { available: false, readyAt: null, unavailableReason: reason },
    slotDate: null,
    slots: [],
  };
}

export function getPickupOptions(ctx: PickupContext): PickupOptions {
  const { location, now, settings } = ctx;
  const status = getLocationStatus({
    location,
    hours: ctx.hours,
    closures: ctx.closures,
    now,
    onlineOrderingEnabled: ctx.onlineOrderingEnabled,
  });

  if (status.kind === "paused") {
    return blocked(`${location.name} has paused online orders for a few minutes. Please try again shortly.`);
  }
  if (status.kind === "event") {
    return blocked(
      status.phase === "upcoming"
        ? `Pre-orders for ${location.name} open when the event starts.`
        : `${location.name} has ended.`,
    );
  }

  // Which stretch of opening hours the slots come from.
  let intervals: { start: Date; end: Date }[];
  if (location.type === "event") {
    // Inside the window (checked above), so the window is the hours.
    intervals = [{ start: new Date(location.startsAt!), end: new Date(location.endsAt!) }];
  } else {
    const day = status.kind === "open" ? now : nextOpening(location.id, now, ctx.hours, ctx.closures);
    if (!day) return blocked(`${location.name} is closed and has no opening hours coming up.`);
    // A day open until midnight that carries straight on into the next (24-hour
    // opening, or local test mode) keeps offering slots past midnight, up to
    // OVERNIGHT_SLOT_HOURS from now, instead of stopping at 11:45 PM.
    const horizon = addMinutes(now, OVERNIGHT_SLOT_HOURS * 60);
    intervals = openIntervalsOn(location.id, day, ctx.hours, ctx.closures).map((interval) => {
      const stretchEnd = openStretchEnd(location.id, interval.end, ctx.hours, ctx.closures);
      if (stretchEnd.getTime() === interval.end.getTime()) return interval;
      const end = Math.min(stretchEnd.getTime(), Math.max(interval.end.getTime(), horizon.getTime()));
      return { start: interval.start, end: new Date(end) };
    });
  }

  const earliest = addMinutes(now, location.prepTimeMinutes);
  const limit = settings.maxOrdersPerSlot && settings.maxOrdersPerSlot > 0 ? settings.maxOrdersPerSlot : null;
  const slots: PickupSlot[] = [];

  for (const interval of intervals) {
    const lastStart = addMinutes(interval.end, -settings.lastSlotBufferMinutes);
    let cursor = ceilToSlot(interval.start > earliest ? interval.start : earliest, settings.slotMinutes);
    while (cursor <= lastStart && cursor < interval.end) {
      const startsAt = cursor.toISOString();
      slots.push({ startsAt, available: limit === null || (ctx.slotBookings[startsAt] ?? 0) < limit });
      cursor = addMinutes(cursor, settings.slotMinutes);
    }
  }

  // ASAP only while open, and only if it would be ready before closing.
  let asap: PickupOptions["asap"];
  if (status.kind !== "open") {
    asap = { available: false, readyAt: null, unavailableReason: "We're closed right now. Choose a pickup time." };
  } else {
    const readyAt = estimateAsapReadyAt(now, location.prepTimeMinutes, ctx.activeQueueCount, settings.queueMinutesPerOrder);
    asap =
      readyAt <= status.closesAt
        ? { available: true, readyAt: readyAt.toISOString(), unavailableReason: null }
        : { available: false, readyAt: null, unavailableReason: "Too close to closing for ASAP. Choose a pickup time." };
  }

  const canCheckout = asap.available || slots.some((s) => s.available);
  return {
    canCheckout,
    blockedReason: canCheckout ? null : `No pickup times are left at ${location.name} today.`,
    asap,
    slotDate: slots.length > 0 ? cafeDateKey(new Date(slots[0].startsAt)) : null,
    slots,
  };
}

/** Checks the customer's choice against freshly computed options (server side). */
export function resolvePickupChoice(
  choice: PickupChoice,
  options: PickupOptions,
): { ok: true; pickup: ResolvedPickup } | { ok: false; message: string } {
  if (!options.canCheckout) return { ok: false, message: options.blockedReason ?? "Pickup isn't available right now." };

  if (choice.type === "asap") {
    if (!options.asap.available || !options.asap.readyAt) {
      return { ok: false, message: options.asap.unavailableReason ?? "ASAP isn't available right now." };
    }
    return {
      ok: true,
      pickup: { pickupType: "asap", scheduledFor: null, estimatedReadyAt: new Date(options.asap.readyAt) },
    };
  }

  const wanted = new Date(choice.slot);
  const slot = Number.isNaN(wanted.getTime())
    ? undefined
    : options.slots.find((s) => new Date(s.startsAt).getTime() === wanted.getTime());
  if (!slot) return { ok: false, message: "That pickup time isn't available any more. Please choose another." };
  if (!slot.available) return { ok: false, message: "That pickup time just filled up. Please choose another." };

  const at = new Date(slot.startsAt);
  return { ok: true, pickup: { pickupType: "scheduled", scheduledFor: at, estimatedReadyAt: at } };
}

/**
 * The payment webhook's re-check: can the location still fulfil this order?
 * (Slot capacity is not re-checked -- the unpaid order already held its place.)
 */
export function isPickupStillServiceable(
  pickup: { pickupType: "asap" | "scheduled"; scheduledFor: Date | null },
  ctx: Omit<PickupContext, "settings" | "activeQueueCount" | "slotBookings">,
): { ok: true } | { ok: false; reason: string } {
  const { location, now } = ctx;
  const status = getLocationStatus({
    location,
    hours: ctx.hours,
    closures: ctx.closures,
    now,
    onlineOrderingEnabled: ctx.onlineOrderingEnabled,
  });

  if (status.kind === "paused") {
    return { ok: false, reason: `${location.name} paused online orders before your payment went through.` };
  }
  if (status.kind === "event") {
    return {
      ok: false,
      reason:
        status.phase === "ended"
          ? `${location.name} ended before your payment went through.`
          : `${location.name} isn't taking orders yet.`,
    };
  }

  if (pickup.pickupType === "asap" || !pickup.scheduledFor) {
    return status.kind === "open"
      ? { ok: true }
      : { ok: false, reason: `${location.name} closed before your payment went through.` };
  }

  const at = pickup.scheduledFor;
  const intervals =
    location.type === "event"
      ? [{ start: new Date(location.startsAt!), end: new Date(location.endsAt!) }]
      : openIntervalsOn(location.id, at, ctx.hours, ctx.closures);
  return intervals.some((i) => i.start <= at && at < i.end)
    ? { ok: true }
    : { ok: false, reason: `${location.name} is no longer open at your pickup time.` };
}

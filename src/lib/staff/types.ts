/**
 * Shapes the staff page hands from the server to the dashboard. Plain data,
 * so they serialise into client components.
 */
import type { Closure, WeeklyHours } from "@/lib/locations/status";

export interface StaffSettings {
  /** Minutes past the estimated ready time before a ticket turns amber / red. */
  warningMinutes: number;
  lateMinutes: number;
  /** The new-order chime repeats this often until acknowledged. */
  repeatSeconds: number;
  /** Print sizes, in millimetres. */
  receiptWidthMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
}

export const DEFAULT_STAFF_SETTINGS: StaffSettings = {
  warningMinutes: 5,
  lateMinutes: 10,
  repeatSeconds: 15,
  receiptWidthMm: 80,
  labelWidthMm: 57,
  labelHeightMm: 32,
};

export interface StaffLocationContext {
  id: string;
  name: string;
  type: "cafe" | "event";
  prepTimeMinutes: number;
  startsAt: string | null;
  endsAt: string | null;
  acceptingOrders: boolean;
  pausedUntil: string | null;
  pausedAt: string | null;
  /** The global `orders.accepting_online_orders` switch. */
  onlineOrderingEnabled: boolean;
  hours: WeeklyHours[];
  closures: Closure[];
  settings: StaffSettings;
}

/** The parts of a location that change while the dashboard is open. */
export interface LiveLocationState {
  acceptingOrders: boolean;
  pausedUntil: string | null;
  pausedAt: string | null;
  onlineOrderingEnabled: boolean;
}

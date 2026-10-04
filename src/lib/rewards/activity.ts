/**
 * The points activity log, from `list_my_points_activity()`. Isomorphic like
 * the order lists: the server renders the first page and "Show more" fetches
 * the next through a Server Action.
 */
export type ActivityKind = "earned" | "redeemed" | "reserved" | "returned" | "reversed" | "adjusted" | "expired";

export interface ActivityEntry {
  id: string;
  createdAt: string;
  kind: ActivityKind;
  points: number;
  description: string | null;
  orderId: string | null;
  orderNumber: string | null;
  /** For reserved entries: still held, or given back because the checkout was not finished. */
  held: boolean;
}

export interface ActivityRow {
  id: string;
  created_at: string;
  kind: string;
  points: number;
  description: string | null;
  order_id: string | null;
  order_number: string | null;
  reservation_status: string | null;
}

const KINDS: readonly ActivityKind[] = ["earned", "redeemed", "reserved", "returned", "reversed", "adjusted", "expired"];

export function toActivityEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    kind: (KINDS as readonly string[]).includes(row.kind) ? (row.kind as ActivityKind) : "adjusted",
    points: row.points,
    description: row.description,
    // The order link only when the order is still the customer's.
    orderId: row.order_number ? row.order_id : null,
    orderNumber: row.order_number,
    held: row.reservation_status === "held",
  };
}

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  earned: "Earned",
  redeemed: "Redeemed",
  reserved: "Reserved",
  returned: "Returned",
  reversed: "Reversed",
  adjusted: "Adjusted",
  expired: "Expired",
};

/** One line of explanation under each kind of entry. */
export function activityNote(entry: Pick<ActivityEntry, "kind" | "description" | "orderNumber" | "held">): string | null {
  switch (entry.kind) {
    case "earned":
      return entry.orderNumber ? `Picked up order ${entry.orderNumber}` : entry.description;
    case "redeemed":
      return entry.description;
    case "reserved": {
      const why = entry.held ? "held until the order is paid" : "checkout not completed";
      return entry.description ? `${entry.description} · ${why}` : why.replace(/^./, (c) => c.toUpperCase());
    }
    case "returned":
      return entry.description ? `${entry.description}, points returned` : "Points returned";
    case "reversed":
      return entry.orderNumber ? `Refund on order ${entry.orderNumber}` : entry.description;
    case "adjusted":
    case "expired":
      return entry.description;
  }
}

export const ACTIVITY_PAGE_SIZE = 15;

/** Opaque "Show more" cursor: the last entry's created_at and id. */
export function encodeActivityCursor(entry: Pick<ActivityEntry, "createdAt" | "id">): string {
  return `${entry.createdAt}|${entry.id}`;
}

export function decodeActivityCursor(cursor: string | null | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const [createdAt, id] = cursor.split("|");
  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { createdAt, id };
}

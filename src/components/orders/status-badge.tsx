import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import { cn } from "@/lib/utils";

/** Colour by meaning: in progress (teal), ready (magenta), done (neutral), ended badly (red). */
const TONES: Record<OrderStatus, string> = {
  pending_payment: "bg-muted text-muted-foreground",
  placed: "bg-brand-teal-soft text-brand-teal-deep",
  accepted: "bg-brand-teal-soft text-brand-teal-deep",
  preparing: "bg-brand-teal-soft text-brand-teal-deep",
  ready: "bg-brand-magenta-deep text-white",
  picked_up: "bg-muted text-foreground",
  cancelled: "bg-destructive/10 text-destructive",
  refunded: "bg-destructive/10 text-destructive",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold", TONES[status], className)}
      data-testid="order-status"
    >
      {status === "ready" ? "Ready" : ORDER_STATUS_LABELS[status]}
    </span>
  );
}

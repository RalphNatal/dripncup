"use client";

/**
 * The Orders tab's dot while one of the customer's orders is on its way
 * (useActiveOrders: the same subscription the Home cards use). Signed-in
 * customers only, and loaded only for them (src/components/shell/nav.tsx),
 * so guests don't download the live-order code or TanStack Query.
 */
import type { OrderListItem } from "@/lib/orders/list";
import { useActiveOrders } from "@/lib/orders/live";
import { QueryProvider } from "@/lib/query-client";
import { cn } from "@/lib/utils";

function Dot({ userId, initial, className }: { userId: string; initial: OrderListItem[]; className?: string }) {
  const orders = useActiveOrders(userId, initial);
  if (orders.length === 0) return null;
  const ready = orders.some((o) => o.status === "ready");
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="orders-dot"
        className={cn("size-2.5 rounded-full ring-2 ring-background", ready ? "bg-brand-magenta-deep" : "bg-brand-teal", className)}
      />
      <span className="sr-only">{ready ? " (order ready)" : " (order in progress)"}</span>
    </>
  );
}

export function LiveOrderDot(props: { userId: string; initial: OrderListItem[]; className?: string }) {
  return (
    <QueryProvider>
      <Dot {...props} />
    </QueryProvider>
  );
}

"use client";

/**
 * Recently completed: today's picked-up, cancelled and refunded orders at this
 * counter, newest first, searchable by order number or cup name. Tapping one
 * opens the detail view (history and reprints).
 */
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import type { StaffOrder } from "@/lib/staff/queue";

import { OrderNumber } from "./ticket-card";

function finishedAt(order: StaffOrder): string | null {
  return order.pickedUpAt ?? order.cancelledAt;
}

export function completedToday(orders: readonly StaffOrder[], todayStart: Date): StaffOrder[] {
  return orders
    .filter((o) => o.status === "picked_up" || o.status === "cancelled" || o.status === "refunded")
    .filter((o) => {
      const at = finishedAt(o);
      return at !== null && new Date(at) >= todayStart;
    })
    .sort((a, b) => (finishedAt(b) ?? "").localeCompare(finishedAt(a) ?? ""));
}

export function CompletedDrawer({
  open,
  onOpenChange,
  orders,
  onOpenOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: StaffOrder[];
  onOpenOrder: (order: StaffOrder) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter(
      (o) => o.orderNumber.toLowerCase().includes(term) || (o.cupName ?? "").toLowerCase().includes(term),
    );
  }, [orders, search]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl [&_[data-slot=sheet-close]]:size-14 [&_[data-slot=sheet-close]_svg]:size-7">
        <SheetHeader className="border-b p-5 pr-20">
          <SheetTitle className="font-heading text-3xl font-extrabold">Recently completed</SheetTitle>
          <SheetDescription className="text-base">Picked up and cancelled today.</SheetDescription>
        </SheetHeader>
        <div className="border-b p-4">
          <label className="relative block">
            <span className="sr-only">Search by order number or cup name</span>
            <Search className="absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Order number or cup name"
              className="focus-ring min-h-14 w-full rounded-xl border-2 bg-card pr-4 pl-13 text-lg"
            />
          </label>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto p-4" data-testid="completed-list">
          {visible.length === 0 ? (
            <li className="p-6 text-center text-lg text-muted-foreground">
              {orders.length === 0 ? "Nothing completed yet today." : `No order matches “${search}”.`}
            </li>
          ) : (
            visible.map((order) => {
              const at = finishedAt(order);
              return (
                <li key={order.id}>
                  <button
                    type="button"
                    onClick={() => onOpenOrder(order)}
                    data-testid="completed-order"
                    className="focus-ring flex min-h-16 w-full items-center gap-3 rounded-xl border-2 bg-card px-4 py-2 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xl font-extrabold">{order.cupName ?? "No name"}</p>
                      <OrderNumber value={order.orderNumber} className="text-base" />
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          "font-bold",
                          order.status === "picked_up" ? "text-success" : "text-destructive",
                        )}
                      >
                        {ORDER_STATUS_LABELS[order.status]}
                      </p>
                      {at ? <p className="tabular text-sm text-muted-foreground">{formatCafeTimeOfDay(new Date(at))}</p> : null}
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

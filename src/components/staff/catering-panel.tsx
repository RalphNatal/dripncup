"use client";

/**
 * Today's catering, as a prep list: confirmed requests for today (Honolulu
 * date) at this counter. Read-only; the catering workflow itself arrives in
 * Phase 8. Comes from staff_catering_prep(), which hands out only what the
 * counter needs (no quote, budget or email).
 */
import { Phone, Truck, Store } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatCafeTimeOfDay } from "@/lib/time";

import type { CateringPrep } from "@/lib/staff/client";

export function CateringPanel({
  open,
  onOpenChange,
  locationName,
  requests,
  loading,
  failed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationName: string;
  requests: CateringPrep[];
  loading: boolean;
  failed: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl [&_[data-slot=sheet-close]]:size-14 [&_[data-slot=sheet-close]_svg]:size-7">
        <SheetHeader className="border-b p-5 pr-20">
          <SheetTitle className="font-heading text-3xl font-extrabold">Today&apos;s catering</SheetTitle>
          <SheetDescription className="text-base">Confirmed orders to prepare at {locationName} today.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4" data-testid="catering-list">
          {loading ? (
            <p className="text-lg text-muted-foreground">Loading…</p>
          ) : failed ? (
            <p className="text-lg text-destructive">Couldn&apos;t load today&apos;s catering. Close and try again.</p>
          ) : requests.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed p-8 text-center">
              <p className="text-xl font-bold">No catering today</p>
              <p className="text-base text-muted-foreground">Confirmed catering orders for today will show up here.</p>
            </div>
          ) : (
            requests.map((request) => (
              <article key={request.id} className="space-y-3 rounded-2xl border-2 bg-card p-4" data-testid="catering-request">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-heading text-3xl font-extrabold">{formatCafeTimeOfDay(new Date(request.eventAt))}</p>
                  <p className="tabular text-base text-muted-foreground">{request.requestNumber}</p>
                </div>
                <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
                  <span className="rounded-lg bg-muted px-2.5 py-1">{request.headcount} people</span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal-soft px-2.5 py-1 text-brand-teal-deep">
                    {request.fulfillment === "delivery" ? (
                      <Truck className="size-5" aria-hidden="true" />
                    ) : (
                      <Store className="size-5" aria-hidden="true" />
                    )}
                    {request.fulfillment === "delivery" ? "Delivery" : "Pickup"}
                  </span>
                </p>
                {request.fulfillment === "delivery" && request.deliveryAddress ? (
                  <p className="text-lg">Deliver to: {request.deliveryAddress}</p>
                ) : null}
                <ul className="space-y-1 text-lg">
                  {request.items.map((item, index) => (
                    <li key={index}>
                      <span className="tabular font-extrabold">{item.quantity}×</span> {item.name}
                      {item.notes ? <span className="text-muted-foreground"> — {item.notes}</span> : null}
                    </li>
                  ))}
                </ul>
                {request.customDrinkRequest ? (
                  <p className="rounded-lg bg-brand-pink-soft px-3 py-2 text-lg">
                    <span className="font-bold">Custom drink:</span> {request.customDrinkRequest}
                  </p>
                ) : null}
                {request.notes ? (
                  <p className="rounded-lg border-2 border-brand-magenta-deep bg-brand-pink-soft px-3 py-2 text-lg font-bold">
                    Note: {request.notes}
                  </p>
                ) : null}
                <p className="flex flex-wrap items-center gap-x-3 text-lg">
                  <span className="font-bold">{request.contactName ?? "No contact name"}</span>
                  {request.contactPhone ? (
                    <a href={`tel:${request.contactPhone}`} className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand-teal-deep underline">
                      <Phone className="size-5" aria-hidden="true" />
                      {request.contactPhone}
                    </a>
                  ) : null}
                </p>
              </article>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

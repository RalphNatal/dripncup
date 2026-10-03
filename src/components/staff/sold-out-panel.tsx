"use client";

/**
 * Sold out, for this counter: search the menu and its options and switch
 * them off. Each switch-off lasts until the end of the day (the default:
 * it resets at the next day's opening, Honolulu time) or until someone
 * switches it back on. Changes go through set_sold_out(), which records who
 * made them, and take effect on the very next menu load and cart check.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Closure, WeeklyHours } from "@/lib/locations/status";
import { formatCafeDateTime, formatCafeTimeOfDay, cafeDateKey, addDays } from "@/lib/time";
import { cn } from "@/lib/utils";

import { fetchAvailability, fetchSellables, setSoldOut, type AvailabilityFlag, type SellableItem } from "@/lib/staff/client";
import { endOfDayResetAt, soldOutUntil, type SoldOutDuration } from "@/lib/staff/sold-out";

function resetLabel(at: Date, now: Date): string {
  if (cafeDateKey(at) === cafeDateKey(addDays(now, 1))) return `tomorrow ${formatCafeTimeOfDay(at)}`;
  return formatCafeDateTime(at);
}

function flagFor(item: SellableItem, flags: readonly AvailabilityFlag[], now: Date): AvailabilityFlag | null {
  return (
    flags.find(
      (f) =>
        (item.kind === "product" ? f.productId === item.id : f.optionId === item.id) &&
        (!f.availableFrom || new Date(f.availableFrom) > now),
    ) ?? null
  );
}

export function SoldOutPanel({
  open,
  onOpenChange,
  location,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  location: { id: string; name: string; type: "cafe" | "event"; hours: WeeklyHours[]; closures: Closure[] };
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [duration, setDuration] = useState<SoldOutDuration>("end_of_day");
  const [busyId, setBusyId] = useState<string | null>(null);

  const sellables = useQuery({
    queryKey: ["staff-sellables", location.id],
    queryFn: () => fetchSellables(location),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const flags = useQuery({
    queryKey: ["staff-availability", location.id],
    queryFn: () => fetchAvailability(location.id),
    enabled: open,
    staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  });

  const now = new Date();
  const resetAt = endOfDayResetAt({ location, hours: location.hours, closures: location.closures, now });

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const items = sellables.data ?? [];
    return term ? items.filter((i) => i.name.toLowerCase().includes(term) || i.group.toLowerCase().includes(term)) : items;
  }, [sellables.data, search]);

  const soldOutCount = (sellables.data ?? []).filter((item) => flagFor(item, flags.data ?? [], now)).length;

  async function toggle(item: SellableItem, soldOut: boolean) {
    setBusyId(item.id);
    try {
      const until = soldOut ? soldOutUntil(duration, { location, hours: location.hours, closures: location.closures, now: new Date() }) : null;
      const result = await setSoldOut(location.id, item, soldOut, until);
      if (result.outcome === "error") toast.error(result.message);
      else toast.success(soldOut ? `${item.name} is sold out` : `${item.name} is back on`);
      await queryClient.invalidateQueries({ queryKey: ["staff-availability", location.id] });
    } finally {
      setBusyId(null);
    }
  }

  const groups = new Map<string, SellableItem[]>();
  for (const item of visible) {
    const key = `${item.kind === "product" ? "Menu" : "Options"} · ${item.group}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl [&_[data-slot=sheet-close]]:size-14 [&_[data-slot=sheet-close]_svg]:size-7">
        <SheetHeader className="border-b p-5 pr-20">
          <SheetTitle className="font-heading text-3xl font-extrabold">Sold out</SheetTitle>
          <SheetDescription className="text-base">
            {location.name} · {soldOutCount === 0 ? "Everything is available" : `${soldOutCount} sold out`}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 border-b p-4">
          <label className="relative block">
            <span className="sr-only">Search products and options</span>
            <Search className="absolute top-1/2 left-4 size-6 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search drinks, food, milks, syrups…"
              className="focus-ring min-h-14 w-full rounded-xl border-2 bg-card pr-4 pl-13 text-lg"
            />
          </label>
          <fieldset>
            <legend className="mb-1.5 text-base font-bold">When I mark something sold out, keep it off</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["end_of_day", "Until end of day", `Back on ${resetLabel(resetAt, now)}`],
                  ["until_back_on", "Until I turn it back on", "Stays off until switched on"],
                ] as const
              ).map(([value, label, hint]) => (
                <label
                  key={value}
                  className={cn(
                    "flex min-h-14 cursor-pointer flex-col justify-center rounded-xl border-2 px-3 py-2",
                    duration === value ? "border-brand-teal-deep bg-brand-teal-soft" : "bg-card",
                  )}
                >
                  <span className="flex items-center gap-2 text-base font-bold">
                    <input
                      type="radio"
                      name="sold-out-duration"
                      value={value}
                      checked={duration === value}
                      onChange={() => setDuration(value)}
                      className="size-5 accent-[var(--brand-teal-deep)]"
                    />
                    {label}
                  </span>
                  <span className="pl-7 text-sm text-muted-foreground">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex-1 overflow-y-auto p-4" data-testid="sold-out-list">
          {sellables.isPending ? (
            <p className="text-lg text-muted-foreground">Loading the menu…</p>
          ) : sellables.isError ? (
            <p className="text-lg text-destructive">Couldn&apos;t load the menu. Close and try again.</p>
          ) : visible.length === 0 ? (
            <p className="text-lg text-muted-foreground">Nothing matches “{search}”.</p>
          ) : (
            [...groups.entries()].map(([group, items]) => (
              <section key={group} className="mb-5">
                <h3 className="mb-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">{group}</h3>
                <ul className="space-y-2">
                  {items.map((item) => {
                    const flag = flagFor(item, flags.data ?? [], now);
                    return (
                      <li
                        key={`${item.kind}-${item.id}`}
                        data-testid="sold-out-row"
                        data-sold-out={flag ? "true" : "false"}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border-2 p-2 pl-4",
                          flag ? "border-destructive bg-[color-mix(in_oklab,var(--destructive)_8%,var(--card))]" : "bg-card",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-lg font-bold">{item.name}</p>
                          {flag ? (
                            <p className="text-sm font-semibold text-destructive">
                              Sold out{" "}
                              {flag.availableFrom
                                ? `· back ${resetLabel(new Date(flag.availableFrom), now)}`
                                : "· until turned back on"}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={busyId === item.id}
                          onClick={() => void toggle(item, !flag)}
                          aria-label={flag ? `Mark ${item.name} available` : `Mark ${item.name} sold out`}
                          className={cn(
                            "focus-ring min-h-14 min-w-36 rounded-xl px-4 text-lg font-extrabold disabled:opacity-50",
                            flag ? "bg-brand-teal-deep text-white" : "border-2 border-destructive text-destructive",
                          )}
                        >
                          {flag ? "Turn back on" : "Sold out"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

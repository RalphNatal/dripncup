"use client";

/**
 * ASAP or a 15-minute slot. The options come from the server (getPickupOptions)
 * and are checked again when the order is created, so a slot that fills up
 * in the meantime is caught there too.
 */
import { useId } from "react";

import type { PickupChoice, PickupOptions } from "@/lib/checkout/pickup";
import { cafeDateKey, formatCafeDate, formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

function dayLabel(slotDate: string | null): string {
  if (!slotDate) return "";
  const now = new Date();
  if (slotDate === cafeDateKey(now)) return "Today";
  if (slotDate === cafeDateKey(new Date(now.getTime() + 24 * 60 * 60_000))) return "Tomorrow";
  // Noon avoids landing on the neighbouring day in any timezone.
  return formatCafeDate(new Date(`${slotDate}T12:00:00-10:00`));
}

export function PickupPicker({
  options,
  value,
  error,
  onChange,
}: {
  options: PickupOptions;
  value: PickupChoice | null;
  error: string | null;
  onChange: (choice: PickupChoice) => void;
}) {
  const id = useId();
  const availableSlots = options.slots.filter((s) => s.available);
  const day = dayLabel(options.slotDate);
  const scheduled = value?.type === "scheduled";

  if (!options.canCheckout) {
    return <p className="text-sm text-muted-foreground">{options.blockedReason}</p>;
  }

  const card = "flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border bg-card px-4 py-3 has-checked:border-brand-teal-deep has-checked:ring-1 has-checked:ring-brand-teal-deep has-disabled:cursor-not-allowed has-disabled:opacity-60";

  return (
    <div className="space-y-2">
      <label className={card}>
        <input
          type="radio"
          name={`${id}-pickup`}
          className="mt-1 size-5 accent-brand-teal-deep"
          checked={value?.type === "asap"}
          disabled={!options.asap.available}
          onChange={() => onChange({ type: "asap" })}
        />
        <span>
          <span className="block font-semibold">As soon as possible</span>
          <span className="block text-sm text-muted-foreground">
            {options.asap.available && options.asap.readyAt
              ? `Ready around ${formatCafeTimeOfDay(new Date(options.asap.readyAt))}`
              : (options.asap.unavailableReason ?? "Not available right now")}
          </span>
        </span>
      </label>

      <label className={card}>
        <input
          type="radio"
          name={`${id}-pickup`}
          className="mt-1 size-5 accent-brand-teal-deep"
          checked={scheduled}
          disabled={availableSlots.length === 0}
          onChange={() => availableSlots[0] && onChange({ type: "scheduled", slot: availableSlots[0].startsAt })}
        />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Schedule{day ? ` for ${day.toLowerCase() === "today" ? "later today" : day}` : ""}</span>
          <span className="block text-sm text-muted-foreground">
            {availableSlots.length > 0 ? "Pick a 15-minute pickup window" : "No pickup times left today"}
          </span>
        </span>
      </label>

      {scheduled ? (
        <div className="pl-1">
          <label htmlFor={`${id}-slot`} className="text-sm font-semibold">
            Pickup time{day ? ` (${day})` : ""}
          </label>
          <select
            id={`${id}-slot`}
            value={value.slot}
            onChange={(event) => onChange({ type: "scheduled", slot: event.target.value })}
            className="focus-ring mt-1 block h-11 w-full rounded-xl border bg-card px-3 text-base"
          >
            {options.slots.map((slot) => (
              <option key={slot.startsAt} value={slot.startsAt} disabled={!slot.available}>
                {formatCafeTimeOfDay(new Date(slot.startsAt))}
                {slot.available ? "" : " (full)"}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={cn("text-sm font-semibold text-destructive")}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

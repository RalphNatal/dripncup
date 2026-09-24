"use client";

import { Minus, Plus, Trash } from "lucide-react";

import { MAX_LINE_QUANTITY } from "@/lib/pricing";

/**
 * Line quantity with 44px buttons. At 1, the minus becomes a remove, so the
 * customer never lands on a zero-quantity line.
 */
export function QuantityStepper({
  label,
  value,
  onChange,
  onRemove,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  onRemove: () => void;
}) {
  const button =
    "focus-ring inline-flex size-11 items-center justify-center rounded-full border bg-card hover:bg-muted disabled:opacity-40";
  return (
    <div role="group" aria-label={`Quantity of ${label}`} className="flex items-center gap-1">
      {value <= 1 ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className={button}>
          <Trash className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <button type="button" onClick={() => onChange(value - 1)} aria-label={`Decrease quantity of ${label}`} className={button}>
          <Minus className="size-4" aria-hidden="true" />
        </button>
      )}
      <output aria-live="polite" className="tabular min-w-8 text-center text-base font-bold">
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= MAX_LINE_QUANTITY}
        aria-label={`Increase quantity of ${label}`}
        className={button}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

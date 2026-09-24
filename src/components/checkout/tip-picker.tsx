"use client";

/**
 * Tip presets from settings, plus a custom amount. Preset amounts are shown
 * on the post-discount, pre-tax base -- the same base the server uses.
 */
import { useId } from "react";

import { formatCents } from "@/lib/money";
import { percentOf } from "@/lib/pricing";
import { cn } from "@/lib/utils";

/** A preset, or "custom" with the amount in `customText`. */
export type TipMode = { kind: "percent"; percent: number } | { kind: "custom" };

export function TipPicker({
  presets,
  value,
  customText,
  taxableCents,
  error,
  onChange,
  onCustomTextChange,
}: {
  presets: readonly number[];
  value: TipMode;
  customText: string;
  /** Null until the first quote arrives. */
  taxableCents: number | null;
  error: string | null;
  onChange: (mode: TipMode) => void;
  onCustomTextChange: (text: string) => void;
}) {
  const id = useId();
  const chip =
    "flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-2xl border bg-card px-2 py-1.5 text-center has-checked:border-brand-teal-deep has-checked:bg-brand-teal-soft has-checked:ring-1 has-checked:ring-brand-teal-deep has-focus-visible:ring-2 has-focus-visible:ring-ring";

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {presets.map((percent) => (
          <label key={percent} className={chip}>
            <input
              type="radio"
              name={`${id}-tip`}
              className="sr-only"
              checked={value.kind === "percent" && value.percent === percent}
              onChange={() => onChange({ kind: "percent", percent })}
            />
            <span className="font-semibold">{percent === 0 ? "No tip" : `${percent}%`}</span>
            {percent > 0 && taxableCents !== null ? (
              <span className="tabular text-xs text-muted-foreground">{formatCents(percentOf(taxableCents, percent))}</span>
            ) : null}
          </label>
        ))}
        <label className={chip}>
          <input
            type="radio"
            name={`${id}-tip`}
            className="sr-only"
            checked={value.kind === "custom"}
            onChange={() => onChange({ kind: "custom" })}
          />
          <span className="font-semibold">Custom</span>
        </label>
      </div>

      {value.kind === "custom" ? (
        <div className="mt-3">
          <label htmlFor={`${id}-custom`} className="text-sm font-semibold">
            Custom tip
          </label>
          <div className="relative mt-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">$</span>
            <input
              id={`${id}-custom`}
              inputMode="decimal"
              autoComplete="off"
              value={customText}
              onChange={(event) => onCustomTextChange(event.target.value)}
              placeholder="0.00"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${id}-error` : undefined}
              className={cn(
                "focus-ring h-11 w-full rounded-xl border bg-card pr-3 pl-7 text-base tabular",
                error && "border-destructive",
              )}
            />
          </div>
        </div>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** "3.50", "$3.5", "3" -> cents; null for anything else. */
export function parseTipText(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d{0,4}(\.\d{0,2})?$/.test(cleaned) || cleaned === ".") return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
}

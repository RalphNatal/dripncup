"use client";

/**
 * A date and a time, in Honolulu. Native inputs (good on phones, keyboard
 * friendly), labelled as Hawaii time whatever the admin's own device is set
 * to: the values are wall-clock strings ("2026-10-18", "10:00") that the
 * server turns into an instant with cafeInstant().
 */
import { useId } from "react";

import { inputClass } from "./form-layout";

export interface HonoluluDateTime {
  date: string;
  time: string;
}

export function HonoluluDateTimeField({
  label,
  value,
  onChange,
  error,
  hint,
  minDate,
  timeLabel = "Time",
  dateOnly = false,
  name,
}: {
  label: string;
  value: HonoluluDateTime;
  onChange: (value: HonoluluDateTime) => void;
  error?: string;
  hint?: string;
  /** Earliest date the picker offers ("YYYY-MM-DD"). */
  minDate?: string;
  timeLabel?: string;
  dateOnly?: boolean;
  /** Prefix for the inputs' names and test ids. */
  name: string;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset className="space-y-1.5" data-invalid={error ? true : undefined}>
      <legend className="text-sm font-semibold">
        {label} <span className="font-normal text-muted-foreground">(Honolulu time)</span>
      </legend>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="sr-only" htmlFor={`${id}-date`}>
          {label}: date
        </label>
        <input
          id={`${id}-date`}
          name={`${name}Date`}
          type="date"
          value={value.date}
          min={minDate}
          onChange={(event) => onChange({ ...value, date: event.target.value })}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass}
        />
        {dateOnly ? null : (
          <>
            <label className="sr-only" htmlFor={`${id}-time`}>
              {label}: {timeLabel.toLowerCase()}
            </label>
            <input
              id={`${id}-time`}
              name={`${name}Time`}
              type="time"
              step={900}
              value={value.time}
              onChange={(event) => onChange({ ...value, time: event.target.value })}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className={`${inputClass} w-36`}
            />
          </>
        )}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

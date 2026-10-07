import type { ReactNode } from "react";

import { formatCafeDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Admin form layout: titled sections, a grid of fields inside each, and a
 * sticky action bar that stays reachable on a phone. Fields themselves are
 * the inputs below (AdminInput, AdminTextarea, AdminField), which wire up
 * labels, descriptions and errors for screen readers.
 */
export function FormSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl border bg-card p-5 md:p-6">
      <h2 className="text-lg font-bold">{title}</h2>
      {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

/** The bottom bar with the form's buttons. */
export function FormActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur md:mx-0 md:rounded-2xl md:border">
      {note ? <div className="mr-auto text-sm text-muted-foreground">{note}</div> : null}
      {children}
    </div>
  );
}

/** "Created by Ada on Oct 6, 9:14 AM · Last changed by …" -- the audit trail on every admin record. */
export function AuditTrail({
  createdAt,
  createdBy,
  updatedAt,
  updatedBy,
}: {
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Created {createdBy ? `by ${createdBy} ` : ""}on {formatCafeDateTime(new Date(createdAt))}
      {updatedAt !== createdAt ? ` · Last changed ${updatedBy ? `by ${updatedBy} ` : ""}on ${formatCafeDateTime(new Date(updatedAt))}` : ""} (Honolulu time)
    </p>
  );
}

/** A labelled field wrapper: label, the control, an optional hint and the error. */
export function AdminField({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)} data-invalid={error ? true : undefined}>
      <label htmlFor={id} className="block text-sm font-semibold">
        {label}
      </label>
      {children}
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
    </div>
  );
}

/** aria-describedby for an AdminField's control. */
export function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  return [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
}

export const inputClass =
  "focus-ring h-11 w-full rounded-xl border bg-background px-3 text-sm aria-invalid:border-destructive disabled:opacity-60";
export const textareaClass =
  "focus-ring min-h-24 w-full rounded-xl border bg-background px-3 py-2 text-sm aria-invalid:border-destructive";

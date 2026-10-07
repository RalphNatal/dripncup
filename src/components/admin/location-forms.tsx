"use client";

/**
 * The Locations screen's forms: the cafe's details, its weekly hours, a
 * closure or holiday hours, and pause / resume. Each saves on its own.
 */
import { LoaderCircle, PauseCircle, PlayCircle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveCafeAction, saveClosureAction, saveHoursAction, setPauseAction, type CafeInput, type ClosureInput } from "@/lib/locations/admin-actions";
import type { HoursRange } from "@/lib/locations/admin";
import { hoursProblem } from "@/lib/locations/hours-rules";
import { cn } from "@/lib/utils";

import { AdminField, FormActions, FormSection, inputClass, textareaClass } from "./form-layout";
import { ImageUploadField } from "./image-upload-field";

type Result = { ok: boolean; message?: string; fieldErrors?: Record<string, string> };

function useSave() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function run(call: () => Promise<Result>): Promise<boolean> {
    setPending(true);
    try {
      const result = await call();
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message ?? "That didn't work.");
        return false;
      }
      setErrors({});
      toast.success(result.message ?? "Saved.");
      router.refresh();
      return true;
    } finally {
      setPending(false);
    }
  }
  return { pending, errors, run };
}

const SaveButton = ({ pending, children }: { pending: boolean; children: React.ReactNode }) => (
  <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white disabled:opacity-60">
    {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
    {children}
  </button>
);

// ---------------------------------------------------------------------------

export function CafeForm({ initial, supabaseUrl }: { initial: CafeInput; supabaseUrl: string }) {
  const id = useId();
  const [values, setValues] = useState(initial);
  const { pending, errors, run } = useSave();
  const field = (key: keyof CafeInput, label: string, opts: { hint?: string; className?: string; long?: boolean; inputMode?: "numeric" | "decimal" | "tel" | "url" } = {}) => (
    <AdminField id={`${id}-${key}`} label={label} hint={opts.hint} error={errors[key]} className={opts.className}>
      {opts.long ? (
        <textarea id={`${id}-${key}`} value={String(values[key] ?? "")} onChange={(e) => setValues({ ...values, [key]: e.target.value })} maxLength={300} className={textareaClass} />
      ) : (
        <input
          id={`${id}-${key}`}
          inputMode={opts.inputMode}
          value={String(values[key] ?? "")}
          onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          aria-invalid={errors[key] ? true : undefined}
          className={inputClass}
        />
      )}
    </AdminField>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveCafeAction(values));
      }}
      noValidate
      className="space-y-5"
      aria-label="Cafe details"
    >
      <FormSection title="The cafe">
        {field("name", "Name")}
        {field("phone", "Phone", { inputMode: "tel", hint: "Shown nowhere yet; the contact number customers see is on Pages & contact." })}
        {field("addressLine1", "Address")}
        {field("addressLine2", "Address line 2")}
        {field("city", "City")}
        {field("postalCode", "ZIP code", { inputMode: "numeric" })}
        {field("mapUrl", "Map link", { className: "md:col-span-2", inputMode: "url", hint: "A Google Maps or Apple Maps share link. Directions otherwise use the address." })}
        {field("latitude", "Latitude", { inputMode: "decimal" })}
        {field("longitude", "Longitude", { inputMode: "decimal" })}
        {field("prepTimeMinutes", "Prep time (minutes)", { inputMode: "numeric", hint: "The ASAP estimate starts from this." })}
        {field("description", "Description", { long: true })}
        {field("pickupInstructions", "Pickup instructions", { long: true, className: "md:col-span-2", hint: "Shown on the confirmation screen and receipts." })}
        <ImageUploadField
          label="Photo"
          bucket="location-images"
          supabaseUrl={supabaseUrl}
          value={values.imagePath}
          onChange={(path) => setValues({ ...values, imagePath: path })}
          previewAlt={values.name}
        />
      </FormSection>
      <FormActions>
        <SaveButton pending={pending}>Save cafe details</SaveButton>
      </FormActions>
    </form>
  );
}

// ---------------------------------------------------------------------------

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

/** Weekly hours: each day closed, or one or more ranges. */
export function HoursEditor({ locationId, initial }: { locationId: string; initial: HoursRange[] }) {
  const id = useId();
  const [ranges, setRanges] = useState(initial.map((r, i) => ({ ...r, key: `r${i}` })));
  const [checked, setChecked] = useState(false);
  const { pending, errors: serverErrors, run } = useSave();
  const errors = checked ? hoursProblem(ranges) : serverErrors;

  const update = (key: string, patch: Partial<HoursRange>) => setRanges((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setChecked(true);
        if (Object.keys(hoursProblem(ranges)).length) return toast.error("Please check the highlighted days.");
        void run(() => saveHoursAction(locationId, ranges.map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt }))));
      }}
      noValidate
      className="space-y-3"
      aria-label="Weekly hours"
      data-testid="hours-editor"
    >
      <ul className="divide-y rounded-3xl border bg-card">
        {MON_FIRST.map((day) => {
          const dayRanges = ranges.filter((r) => r.dayOfWeek === day);
          const error = errors[`day.${day}`];
          return (
            <li key={day} className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid={`hours-${DAYS[day]}`}>
              <span className="w-28 pt-2.5 font-semibold">{DAYS[day]}</span>
              <div className="min-w-0 flex-1 space-y-2">
                {dayRanges.length === 0 ? <p className="pt-2.5 text-sm text-muted-foreground">Closed</p> : null}
                {dayRanges.map((r) => (
                  <div key={r.key} className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`${id}-${r.key}-open`}>
                      {DAYS[day]} opens
                    </label>
                    <input id={`${id}-${r.key}-open`} type="time" step={900} value={r.opensAt} onChange={(e) => update(r.key, { opensAt: e.target.value })} className={cn(inputClass, "w-36")} />
                    <span aria-hidden="true">to</span>
                    <label className="sr-only" htmlFor={`${id}-${r.key}-close`}>
                      {DAYS[day]} closes
                    </label>
                    {r.closesAt === "24:00" ? (
                      <span className="inline-flex h-11 w-36 items-center rounded-xl border bg-muted/40 px-3 text-sm">Midnight</span>
                    ) : (
                      <input id={`${id}-${r.key}-close`} type="time" step={900} value={r.closesAt} onChange={(e) => update(r.key, { closesAt: e.target.value })} className={cn(inputClass, "w-36")} />
                    )}
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" checked={r.closesAt === "24:00"} onChange={(e) => update(r.key, { closesAt: e.target.checked ? "24:00" : "23:00" })} className="size-4 accent-[var(--brand-teal-deep)]" />
                      Until midnight
                    </label>
                    <button type="button" onClick={() => setRanges((rs) => rs.filter((x) => x.key !== r.key))} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border text-destructive" aria-label={`Remove ${DAYS[day]} ${r.opensAt}–${r.closesAt}`}>
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {error ? (
                  <p role="alert" className="text-sm font-medium text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  const last = dayRanges.at(-1);
                  setRanges((rs) => [...rs, { key: `n${Date.now()}-${rs.length}`, dayOfWeek: day, opensAt: last ? "17:00" : "07:00", closesAt: last ? "21:00" : "18:00" }]);
                }}
                className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-xl border px-3 text-sm font-semibold hover:bg-muted"
              >
                <Plus className="size-4" aria-hidden="true" />
                {dayRanges.length ? "Add hours" : "Open"}
                <span className="sr-only"> on {DAYS[day]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <FormActions note="Honolulu time. Applies straight away to the menu, checkout and pickup times.">
        <SaveButton pending={pending}>Save weekly hours</SaveButton>
      </FormActions>
    </form>
  );
}

// ---------------------------------------------------------------------------

export function ClosureDialog({ initial, locations, label }: { initial: ClosureInput; locations: { id: string; name: string }[]; label: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const { pending, errors, run } = useSave();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={cn("focus-ring inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold", initial.id ? "text-brand-teal-deep hover:underline" : "bg-brand-teal-deep text-white")}>
          {initial.id ? null : <Plus className="size-4" aria-hidden="true" />}
          {label}
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-extrabold">{initial.id ? "Edit closure" : "Closure or holiday hours"}</DialogTitle>
          <DialogDescription>For one Honolulu date. It replaces that day&apos;s usual hours.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => saveClosureAction(values))) {
              setOpen(false);
              if (!initial.id) setValues(initial);
            }
          }}
          noValidate
          className="space-y-4"
        >
          <AdminField id={`${id}-date`} label="Date (Honolulu)" error={errors.date}>
            <input id={`${id}-date`} type="date" value={values.date} onChange={(e) => setValues({ ...values, date: e.target.value })} className={inputClass} />
          </AdminField>
          <AdminField id={`${id}-where`} label="Where">
            <select id={`${id}-where`} value={values.locationId ?? ""} onChange={(e) => setValues({ ...values, locationId: e.target.value || null })} className={inputClass}>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="">Every location</option>
            </select>
          </AdminField>
          <fieldset>
            <legend className="text-sm font-semibold">That day</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[true, false].map((closed) => (
                <label key={String(closed)} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm", values.isClosed === closed && "border-brand-teal-deep bg-brand-teal-soft")}>
                  <input type="radio" name={`${id}-closed`} checked={values.isClosed === closed} onChange={() => setValues({ ...values, isClosed: closed })} className="size-4 accent-[var(--brand-teal-deep)]" />
                  {closed ? "Closed all day" : "Special hours"}
                </label>
              ))}
            </div>
          </fieldset>
          {!values.isClosed ? (
            <div className="grid grid-cols-2 gap-3">
              <AdminField id={`${id}-opens`} label="Opens" error={errors.opensAt}>
                <input id={`${id}-opens`} type="time" step={900} value={values.opensAt} onChange={(e) => setValues({ ...values, opensAt: e.target.value })} className={inputClass} />
              </AdminField>
              <AdminField id={`${id}-closes`} label="Closes" error={errors.closesAt}>
                <input id={`${id}-closes`} type="time" step={900} value={values.closesAt} onChange={(e) => setValues({ ...values, closesAt: e.target.value })} className={inputClass} />
              </AdminField>
            </div>
          ) : null}
          <AdminField id={`${id}-reason`} label="Reason" hint="Optional, e.g. Thanksgiving. Customers see it." error={errors.reason}>
            <input id={`${id}-reason`} value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} maxLength={200} className={inputClass} />
          </AdminField>
          <SaveButton pending={pending}>Save</SaveButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

const PAUSE_FOR = [
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "Until I resume", minutes: null },
] as const;

/** Pause online orders at one location, as the staff toggle does. Big targets: this is a phone task. */
export function PauseControl({ locationId, name, paused, until }: { locationId: string; name: string; paused: boolean; until: string | null }) {
  const { pending, run } = useSave();
  if (paused) {
    return (
      <div className="space-y-2" data-testid="pause-control">
        <p className="font-semibold">
          Online orders at {name} are paused{until ? `, back by themselves at ${until}` : " until someone resumes them"}.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => void run(() => setPauseAction(locationId, false, null))}
          className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-2xl bg-brand-teal-deep px-5 text-base font-bold text-white disabled:opacity-60"
        >
          <PlayCircle className="size-6" aria-hidden="true" />
          Resume online orders
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="pause-control">
      <p className="text-sm text-muted-foreground">Customers can keep browsing but can&apos;t check out. Orders already placed stay on the queue.</p>
      <div className="flex flex-wrap gap-2">
        {PAUSE_FOR.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={pending}
            onClick={() => void run(() => setPauseAction(locationId, true, option.minutes))}
            className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-2xl border-2 border-warning bg-card px-4 font-bold disabled:opacity-60"
          >
            <PauseCircle className="size-5 text-warning" aria-hidden="true" />
            Pause {option.minutes ? `for ${option.label}` : "until I resume"}
          </button>
        ))}
      </div>
    </div>
  );
}

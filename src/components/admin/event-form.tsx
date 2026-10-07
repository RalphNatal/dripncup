"use client";

/**
 * Create or edit a pop-up event: one day, its place, its menu (picked from
 * the menu, in order), the staff working it, an optional photo. Saving never
 * publishes; that is a separate, deliberate step (EventControls).
 */
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AdminField, FormActions, FormSection, describedBy, inputClass, textareaClass } from "@/components/admin/form-layout";
import { HonoluluDateTimeField } from "@/components/admin/honolulu-datetime-field";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { ProductPicker } from "@/components/admin/product-picker";
import { saveEventAction } from "@/lib/events/admin-actions";
import type { AdminEventDetail, PickerProduct } from "@/lib/events/queries";
import type { EventFormInput } from "@/lib/events/schemas";

export interface EventFormValues {
  name: string;
  slug: string;
  description: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  postalCode: string;
  mapUrl: string;
  latitude: string;
  longitude: string;
  date: string;
  startTime: string;
  endTime: string;
  prepTimeMinutes: string;
  imagePath: string | null;
  pickupInstructions: string;
  menu: string[];
  staff: string[];
}

export function EventForm({
  event,
  initial,
  products,
  staff,
  supabaseUrl,
}: {
  event: AdminEventDetail | null;
  initial: EventFormValues;
  products: PickerProduct[];
  staff: { id: string; name: string; email: string | null }[];
  supabaseUrl: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<EventFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const input: EventFormInput = { ...values, id: event?.id ?? null };
      const result = await saveEventAction(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
        return;
      }
      toast.success(event ? "Event saved." : "Event created. Publish it when it's ready.");
      if (event) router.refresh();
      else router.push(`/admin/events/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  const text = (key: keyof EventFormValues & string, label: string, options: { hint?: string; type?: string; className?: string; inputMode?: "numeric" | "decimal" | "url" } = {}) => (
    <AdminField id={`event-${key}`} label={label} hint={options.hint} error={errors[key]} className={options.className}>
      <input
        id={`event-${key}`}
        name={key}
        type={options.type ?? "text"}
        inputMode={options.inputMode}
        value={values[key] as string}
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={describedBy(`event-${key}`, options.hint, errors[key])}
        className={inputClass}
      />
    </AdminField>
  );

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      <FormSection title="The event">
        {text("name", "Name", { className: "md:col-span-2" })}
        {text("slug", "Web address", { hint: "Leave blank to make one from the name and date, e.g. kakaako-market-2026-10-18." })}
        {text("prepTimeMinutes", "Prep time (minutes)", { type: "number", inputMode: "numeric", hint: "Used for the ASAP pickup estimate at the booth." })}
        <AdminField id="event-description" label="Description" error={errors.description} className="md:col-span-2">
          <textarea id="event-description" value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} className={textareaClass} />
        </AdminField>
      </FormSection>

      <FormSection
        title="When"
        description="One event covers one day. For a market over several days, save this day, then use “Duplicate to another date”. An end time earlier than the start runs past midnight."
      >
        <HonoluluDateTimeField name="eventDate" label="Date" dateOnly value={{ date: values.date, time: "" }} onChange={(v) => set("date", v.date)} error={errors.date} />
        <div className="grid grid-cols-2 gap-3">
          {text("startTime", "Starts", { type: "time" })}
          {text("endTime", "Ends", { type: "time" })}
        </div>
      </FormSection>

      <FormSection title="Where" description="An address, a map link or coordinates: customers get a Directions button for whichever you give.">
        {text("addressLine1", "Address", { className: "md:col-span-2" })}
        {text("addressLine2", "Address line 2 (optional)")}
        <div className="grid grid-cols-2 gap-3">
          {text("city", "City")}
          {text("postalCode", "ZIP", { inputMode: "numeric" })}
        </div>
        {text("mapUrl", "Map link (optional)", { type: "url", inputMode: "url", hint: "Paste a Google Maps or Apple Maps share link (https://…).", className: "md:col-span-2" })}
        {text("latitude", "Latitude (optional)", { inputMode: "decimal" })}
        {text("longitude", "Longitude (optional)", { inputMode: "decimal" })}
        <AdminField id="event-pickupInstructions" label="Pickup instructions" error={errors.pickupInstructions} className="md:col-span-2" hint="Shown to customers who order for pickup here.">
          <textarea id="event-pickupInstructions" value={values.pickupInstructions} onChange={(e) => set("pickupInstructions", e.target.value)} maxLength={300} className={textareaClass} />
        </AdminField>
      </FormSection>

      <FormSection title="Menu" description="Only these products can be ordered at the booth. A published event needs at least one.">
        <ProductPicker label="Event menu" products={products} selected={values.menu} onChange={(menu) => set("menu", menu)} error={errors.menu} />
      </FormSection>

      <FormSection title="Staff" description="Who works this booth: they see its queue on the staff screen.">
        {staff.length === 0 ? (
          <p className="text-sm text-muted-foreground md:col-span-2">No staff accounts yet.</p>
        ) : (
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="sr-only">Staff at this event</legend>
            {staff.map((person) => (
              <label key={person.id} className="flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm">
                <input
                  type="checkbox"
                  checked={values.staff.includes(person.id)}
                  onChange={(e) => set("staff", e.target.checked ? [...values.staff, person.id] : values.staff.filter((s) => s !== person.id))}
                  className="size-5 accent-[var(--brand-teal-deep)]"
                />
                <span className="font-semibold">{person.name}</span>
                {person.email ? <span className="text-muted-foreground">{person.email}</span> : null}
              </label>
            ))}
          </fieldset>
        )}
      </FormSection>

      <FormSection title="Photo (optional)">
        <ImageUploadField
          label="Event photo"
          bucket="location-images"
          supabaseUrl={supabaseUrl}
          value={values.imagePath}
          onChange={(path) => set("imagePath", path)}
          previewAlt={`${values.name || "Event"} photo`}
          hint="JPEG, PNG or WebP, up to 5 MB. Use Drincup's own photos and artwork only (no third-party characters or trademarks). Location data and other metadata are removed on upload."
        />
      </FormSection>

      <FormActions note={event ? (event.isPublished ? "Published: changes show to customers as soon as you save." : "Not published yet.") : "Saved as a draft (not published)."}>
        <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : event ? "Save changes" : "Create event"}
        </button>
      </FormActions>
    </form>
  );
}

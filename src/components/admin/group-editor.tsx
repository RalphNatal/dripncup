"use client";

/**
 * Create or edit a modifier group and its options. A group is shared by every
 * product it is on, so a change here reaches all of them.
 *
 *   single choice   radios; "required" means one must be picked, so it needs
 *                   a default
 *   multi choice    checkboxes, with a least and most; options can allow
 *                   several units (pumps, shots), charged per unit or once
 */
import { ArrowDown, ArrowUp, LoaderCircle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { ALLERGENS } from "@/components/menu/dietary";
import type { Allergen } from "@/lib/menu/model";
import { saveGroupAction } from "@/lib/menu-admin/actions";
import { validateGroupDraft, type GroupDraft, type OptionDraft } from "@/lib/menu-admin/rules";
import { cn } from "@/lib/utils";

import { AdminField, FormActions, FormSection, inputClass } from "./form-layout";

let counter = 0;
const newKey = () => `new-${Date.now()}-${counter++}`;

export function GroupEditor({ initial, usedOn }: { initial: GroupDraft; usedOn: number }) {
  const id = useId();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [checked, setChecked] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof GroupDraft>(key: K, value: GroupDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const errors = checked ? { ...validateGroupDraft(draft), ...serverErrors } : serverErrors;
  const single = draft.selectionType === "single";

  const updateOption = (index: number, patch: Partial<OptionDraft>) =>
    set("options", draft.options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  const moveOption = (index: number, by: -1 | 1) => {
    const next = [...draft.options];
    const [o] = next.splice(index, 1);
    next.splice(index + by, 0, o);
    set("options", next);
  };
  const setDefault = (index: number, value: boolean) =>
    set("options", draft.options.map((o, i) => (i === index ? { ...o, isDefault: value } : single && value ? { ...o, isDefault: false } : o)));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(validateGroupDraft(draft)).length) {
      toast.error("Please check the highlighted fields.");
      return;
    }
    setPending(true);
    try {
      const result = await saveGroupAction(draft);
      if (!result.ok) {
        setServerErrors(result.fieldErrors ?? { options: result.message });
        toast.error(result.message);
        return;
      }
      setServerErrors({});
      toast.success(result.message ?? "Saved.");
      if (draft.id) router.refresh();
      else router.push(`/admin/menu/modifiers/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5" aria-label="Modifier group">
      {usedOn > 0 ? <p className="rounded-2xl border bg-brand-teal-soft/50 p-3 text-sm">On {usedOn} product{usedOn === 1 ? "" : "s"}: changes here apply to all of them.</p> : null}
      <FormSection title="The group">
        <AdminField id={`${id}-name`} label="Name customers see" error={errors.name}>
          <input id={`${id}-name`} value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={60} aria-invalid={errors.name ? true : undefined} className={inputClass} />
        </AdminField>
        <AdminField id={`${id}-slug`} label="Short name" hint="Used in the menu spreadsheet, e.g. milk or ice-level. Blank = from the name." error={errors.slug}>
          <input id={`${id}-slug`} value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} maxLength={80} className={inputClass} />
        </AdminField>
        <AdminField id={`${id}-description`} label="Help text" hint="Optional, under the group's name." className="md:col-span-2">
          <input id={`${id}-description`} value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={300} className={inputClass} />
        </AdminField>
        <fieldset className="md:col-span-2">
          <legend className="text-sm font-semibold">Customers choose</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["single", "multi"] as const).map((type) => (
              <label key={type} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm", draft.selectionType === type && "border-brand-teal-deep bg-brand-teal-soft")}>
                <input type="radio" name={`${id}-type`} checked={draft.selectionType === type} onChange={() => set("selectionType", type)} className="size-4 accent-[var(--brand-teal-deep)]" />
                {type === "single" ? "One option" : "Any number of options"}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2">
          <input
            type="checkbox"
            checked={draft.isRequired}
            onChange={(e) => setDraft((d) => ({ ...d, isRequired: e.target.checked, minSelections: e.target.checked ? (Number(d.minSelections) > 0 ? d.minSelections : "1") : "0" }))}
            className="size-5 accent-[var(--brand-teal-deep)]"
          />
          <span>
            <span className="font-semibold">Required</span>
            <span className="block text-muted-foreground">{single ? "One option must be picked (so one must be the default)." : "At least the minimum below must be picked."}</span>
          </span>
        </label>
        {!single ? (
          <>
            <AdminField id={`${id}-min`} label="Least choices" error={errors.minSelections}>
              <input id={`${id}-min`} inputMode="numeric" value={draft.minSelections} onChange={(e) => set("minSelections", e.target.value)} aria-invalid={errors.minSelections ? true : undefined} className={cn(inputClass, "max-w-24")} />
            </AdminField>
            <AdminField id={`${id}-max`} label="Most choices" hint="Blank = no limit." error={errors.maxSelections}>
              <input id={`${id}-max`} inputMode="numeric" value={draft.maxSelections} onChange={(e) => set("maxSelections", e.target.value)} aria-invalid={errors.maxSelections ? true : undefined} className={cn(inputClass, "max-w-24")} />
            </AdminField>
            <AdminField id={`${id}-qty`} label="Units per option, at most" hint="1 = on or off. More = a +/− stepper (pumps, shots)." error={errors.maxQuantityPerOption}>
              <input id={`${id}-qty`} inputMode="numeric" value={draft.maxQuantityPerOption} onChange={(e) => set("maxQuantityPerOption", e.target.value)} className={cn(inputClass, "max-w-24")} />
            </AdminField>
            <AdminField id={`${id}-unit`} label="Unit name" hint='Singular, e.g. "pump" or "shot". Optional.' error={errors.quantityUnit}>
              <input id={`${id}-unit`} value={draft.quantityUnit} onChange={(e) => set("quantityUnit", e.target.value.toLowerCase())} maxLength={20} className={cn(inputClass, "max-w-40")} />
            </AdminField>
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-semibold">Charging for several units</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {[true, false].map((perUnit) => (
                  <label key={String(perUnit)} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm", draft.chargePerQuantity === perUnit && "border-brand-teal-deep bg-brand-teal-soft")}>
                    <input type="radio" name={`${id}-charge`} checked={draft.chargePerQuantity === perUnit} onChange={() => set("chargePerQuantity", perUnit)} className="size-4 accent-[var(--brand-teal-deep)]" />
                    {perUnit ? "Price per unit (2 shots = 2×)" : "Price once, however many units"}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : null}
        <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
          <span>
            <span className="font-semibold">On</span>
            <span className="block text-muted-foreground">Switched off, the group is hidden on every product.</span>
          </span>
        </label>
      </FormSection>

      <FormSection title="Options" description="In the order customers see them. A price change is added to the item's price (negative for a discount).">
        <ol className="space-y-2 md:col-span-2" aria-label="Options">
          {draft.options.map((option, index) => (
            <li key={option.key} className="rounded-2xl border p-3" data-testid="option-row">
              <div className="grid gap-2 sm:grid-cols-[1fr_7rem_6rem]">
                <AdminField id={`${id}-o-${option.key}-name`} label="Option" error={errors[`options.${index}.name`]}>
                  <input id={`${id}-o-${option.key}-name`} value={option.name} onChange={(e) => updateOption(index, { name: e.target.value })} maxLength={60} aria-invalid={errors[`options.${index}.name`] ? true : undefined} className={inputClass} />
                </AdminField>
                <AdminField id={`${id}-o-${option.key}-price`} label="Price change ($)" error={errors[`options.${index}.price`]}>
                  <input id={`${id}-o-${option.key}-price`} inputMode="decimal" placeholder="0.00" value={option.price} onChange={(e) => updateOption(index, { price: e.target.value })} className={inputClass} />
                </AdminField>
                {!single ? (
                  <AdminField id={`${id}-o-${option.key}-qty`} label="Units, at most" error={errors[`options.${index}.maxQuantity`]}>
                    <input id={`${id}-o-${option.key}-qty`} inputMode="numeric" value={option.maxQuantity} onChange={(e) => updateOption(index, { maxQuantity: e.target.value })} className={inputClass} />
                  </AdminField>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={single ? `${id}-default` : undefined}
                    checked={option.isDefault}
                    onChange={(e) => setDefault(index, e.target.checked)}
                    className="size-5 accent-[var(--brand-teal-deep)]"
                  />
                  Picked by default
                </label>
                <details className="text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-brand-teal-deep">Allergens {option.allergens.length ? `(${option.allergens.length})` : ""}</summary>
                  <div className="flex flex-wrap gap-2 pb-2">
                    {(Object.keys(ALLERGENS) as Allergen[]).map((tag) => (
                      <label key={tag} className="flex min-h-11 items-center gap-2 rounded-full border px-3">
                        <input
                          type="checkbox"
                          checked={option.allergens.includes(tag)}
                          onChange={() => updateOption(index, { allergens: option.allergens.includes(tag) ? option.allergens.filter((a) => a !== tag) : [...option.allergens, tag] })}
                          className="size-4 accent-[var(--brand-teal-deep)]"
                        />
                        {ALLERGENS[tag].label}
                      </label>
                    ))}
                  </div>
                </details>
                <span className="ml-auto flex gap-1">
                  <button type="button" onClick={() => moveOption(index, -1)} disabled={index === 0} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${option.name || "option"} up`}>
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => moveOption(index, 1)} disabled={index === draft.options.length - 1} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${option.name || "option"} down`}>
                    <ArrowDown className="size-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => set("options", draft.options.filter((_, i) => i !== index))} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border text-destructive" aria-label={`Remove ${option.name || "option"}`}>
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ol>
        {errors.options ? (
          <p role="alert" className="text-sm font-medium text-destructive md:col-span-2">
            {errors.options}
          </p>
        ) : null}
        <div className="md:col-span-2">
          <button
            type="button"
            onClick={() => set("options", [...draft.options, { key: newKey(), id: null, name: "", description: "", price: "", isDefault: false, maxQuantity: draft.maxQuantityPerOption || "1", allergens: [] }])}
            className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:bg-muted"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add an option
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Removing an option that past orders or favourites used archives it instead of deleting it. An option that a product&apos;s &quot;Only show when&quot; rule depends on can&apos;t be removed until that rule changes.
          </p>
        </div>
      </FormSection>

      <FormActions>
        <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {draft.id ? "Save group" : "Create group"}
        </button>
      </FormActions>
    </form>
  );
}

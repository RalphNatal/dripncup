"use client";

/** A reward tier's form, and the manual points adjustment. */
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { PickerProduct } from "@/lib/events/queries";
import { adjustPointsAction, saveTierAction, type TierForm as TierValues } from "@/lib/rewards/admin-actions";
import { cn } from "@/lib/utils";

import { AdminField, FormActions, FormSection, inputClass, textareaClass } from "./form-layout";
import { ProductPicker } from "./product-picker";

const TYPES = [
  { id: "free_item", label: "Free item", help: "One unit of an eligible item free, up to the value cap." },
  { id: "free_modifier", label: "Free add-on", help: "One priced add-on free (a flavor, a topping, an extra shot)." },
  { id: "amount_off", label: "Amount off", help: "A fixed amount off the order." },
] as const;

export function TierForm({
  initial,
  products,
  categories,
  groups,
}: {
  initial: TierValues;
  products: PickerProduct[];
  categories: { id: string; name: string }[];
  groups: { id: string; name: string }[];
}) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof TierValues>(key: K, value: TierValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const toggle = (key: "categoryIds" | "modifierGroupIds", value: string) =>
    set(key, values[key].includes(value) ? values[key].filter((v) => v !== value) : [...values[key], value]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await saveTierAction(values);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return toast.error(result.message);
      }
      setErrors({});
      toast.success(result.message ?? "Saved.");
      if (values.id) router.refresh();
      else router.push(`/admin/rewards/tiers/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5" aria-label="Reward tier">
      <FormSection title="The reward">
        <AdminField id={`${id}-name`} label="Name" error={errors.name}>
          <input id={`${id}-name`} value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={60} className={inputClass} />
        </AdminField>
        <AdminField id={`${id}-cost`} label="Points" error={errors.pointsCost}>
          <input id={`${id}-cost`} inputMode="numeric" value={values.pointsCost} onChange={(e) => set("pointsCost", e.target.value)} className={cn(inputClass, "max-w-32")} />
        </AdminField>
        <AdminField id={`${id}-description`} label="Description" className="md:col-span-2">
          <textarea id={`${id}-description`} value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={300} className={textareaClass} />
        </AdminField>
        <fieldset className="md:col-span-2">
          <legend className="text-sm font-semibold">Type</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {TYPES.map((t) => (
              <label key={t.id} className={cn("flex cursor-pointer gap-2 rounded-2xl border p-3 text-sm", values.type === t.id && "border-brand-teal-deep bg-brand-teal-soft")}>
                <input type="radio" name={`${id}-type`} checked={values.type === t.id} onChange={() => set("type", t.id)} className="mt-0.5 size-4 accent-[var(--brand-teal-deep)]" />
                <span>
                  <span className="font-semibold">{t.label}</span>
                  <span className="block text-muted-foreground">{t.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <AdminField id={`${id}-value`} label={values.type === "amount_off" ? "Amount off ($)" : "Value cap ($)"} hint={values.type === "amount_off" ? undefined : "The most it can be worth. Blank = no cap."} error={errors.value}>
          <input id={`${id}-value`} inputMode="decimal" value={values.value} onChange={(e) => set("value", e.target.value)} className={cn(inputClass, "max-w-32")} />
        </AdminField>
        {values.type === "free_item" ? (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={values.coversModifiers} onChange={(e) => set("coversModifiers", e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
            <span>
              <span className="font-semibold">Covers add-ons</span>
              <span className="block text-muted-foreground">Off: the cap covers the size price; add-ons are charged.</span>
            </span>
          </label>
        ) : null}
        <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2">
          <input type="checkbox" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
          <span className="font-semibold">On (customers can redeem it)</span>
        </label>
      </FormSection>

      <FormSection title="What it applies to" description="Leave everything empty for any item. Items and categories add up: a line qualifies if it matches either.">
        <AdminField id={`${id}-label`} label="Shown to customers as" hint='e.g. "any drink". Explains eligibility in plain words.' error={errors.eligibilityLabel} className="md:col-span-2">
          <input id={`${id}-label`} value={values.eligibilityLabel} onChange={(e) => set("eligibilityLabel", e.target.value)} maxLength={60} className={inputClass} />
        </AdminField>
        {values.type === "free_modifier" ? (
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-semibold">Add-on groups</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {groups.map((g) => (
                <label key={g.id} className="flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm">
                  <input type="checkbox" checked={values.modifierGroupIds.includes(g.id)} onChange={() => toggle("modifierGroupIds", g.id)} className="size-4 accent-[var(--brand-teal-deep)]" />
                  {g.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <>
            <fieldset className="md:col-span-2">
              <legend className="text-sm font-semibold">Categories</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {categories.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm">
                    <input type="checkbox" checked={values.categoryIds.includes(c.id)} onChange={() => toggle("categoryIds", c.id)} className="size-4 accent-[var(--brand-teal-deep)]" />
                    {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <ProductPicker label="Products" products={products} selected={values.productIds} onChange={(ids) => set("productIds", ids)} />
          </>
        )}
      </FormSection>
      <FormActions>
        <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {values.id ? "Save reward" : "Create reward"}
        </button>
      </FormActions>
    </form>
  );
}

export function AdjustPointsForm({ userId, balance }: { userId: string; balance: number }) {
  const id = useId();
  const router = useRouter();
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const amount = Number(points);
  const after = Number.isInteger(amount) && points.trim() ? balance + amount : null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const result = await adjustPointsAction(userId, points, reason);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return toast.error(result.message);
      }
      setErrors({});
      setPoints("");
      setReason("");
      toast.success(result.message ?? "Adjusted.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-3 rounded-3xl border bg-card p-5" aria-label="Adjust points" data-testid="adjust-points">
      <h2 className="text-lg font-bold">Adjust points</h2>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <AdminField id={`${id}-points`} label="Points" hint="Negative to take off." error={errors.points}>
          <input id={`${id}-points`} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} placeholder="50" className={inputClass} />
        </AdminField>
        <AdminField id={`${id}-reason`} label="Reason" hint="Required. The customer doesn't see it; the activity log and audit log do." error={errors.reason}>
          <input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={inputClass} />
        </AdminField>
      </div>
      {after !== null ? <p className="tabular text-sm text-muted-foreground">Balance after: {after} points{after < 0 ? " (negative: can't redeem until positive)" : ""}.</p> : null}
      <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
        Adjust
      </button>
    </form>
  );
}

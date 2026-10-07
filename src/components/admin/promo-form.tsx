"use client";

/** Create or edit a promo code. A redeemed code keeps its code and discount; the rest stays editable. */
import { Lock, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { savePromoAction } from "@/lib/promos/admin-actions";
import { validatePromo, type PromoForm as PromoValues } from "@/lib/promos/admin";
import { cafeDateKey, cafeInstant, cafeTimeKey } from "@/lib/time";
import { cn } from "@/lib/utils";

import { AdminField, FormActions, FormSection, inputClass } from "./form-layout";
import { HonoluluDateTimeField, type HonoluluDateTime } from "./honolulu-datetime-field";

const wall = (iso: string | null): HonoluluDateTime => (iso ? { date: cafeDateKey(new Date(iso)), time: cafeTimeKey(new Date(iso)) } : { date: "", time: "" });
const instant = (v: HonoluluDateTime) => (v.date ? (cafeInstant(v.date, v.time || "00:00")?.toISOString() ?? null) : null);

export function PromoForm({ initial, locked }: { initial: PromoValues; locked: boolean }) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [starts, setStarts] = useState(wall(initial.startsAt));
  const [ends, setEnds] = useState(wall(initial.endsAt));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof PromoValues>(key: K, value: PromoValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const form = { ...values, startsAt: instant(starts), endsAt: instant(ends) };
    const local = validatePromo(form);
    if (Object.keys(local).length) {
      setErrors(local);
      return toast.error("Please check the highlighted fields.");
    }
    setPending(true);
    try {
      const result = await savePromoAction(form);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        return toast.error(result.message);
      }
      setErrors({});
      toast.success(result.message ?? "Saved.");
      if (values.id) router.refresh();
      else router.push(`/admin/promos/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  const input = (key: "code" | "percent" | "amount" | "minSpend" | "maxDiscount" | "usageLimit" | "perUserLimit" | "description", label: string, hint?: string, disabled = false, mode?: "decimal" | "numeric") => (
    <AdminField id={`${id}-${key}`} label={label} hint={hint} error={errors[key]}>
      <input
        id={`${id}-${key}`}
        value={values[key]}
        disabled={disabled}
        inputMode={mode}
        onChange={(e) => set(key, key === "code" ? e.target.value.toUpperCase() : e.target.value)}
        aria-invalid={errors[key] ? true : undefined}
        className={inputClass}
      />
    </AdminField>
  );

  return (
    <form onSubmit={save} noValidate className="space-y-5" aria-label="Promo code">
      {locked ? (
        <p className="flex items-start gap-2 rounded-2xl border bg-muted/40 p-4 text-sm" data-testid="promo-locked">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          This code has been used, so its code and discount can&apos;t change (past receipts must keep matching). Create a new code for a different deal. Dates, limits and the on/off switch can still change.
        </p>
      ) : null}
      <FormSection title="The code">
        {input("code", "Code", "What customers type. Letters, numbers and hyphens; capitals or not, it's the same code.", locked)}
        {input("description", "Note", "For you, not customers.")}
        <fieldset className="md:col-span-2" disabled={locked}>
          <legend className="text-sm font-semibold">Discount</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["percent", "fixed"] as const).map((type) => (
              <label key={type} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm", values.type === type && "border-brand-teal-deep bg-brand-teal-soft", locked && "opacity-60")}>
                <input type="radio" name={`${id}-type`} checked={values.type === type} onChange={() => set("type", type)} className="size-4 accent-[var(--brand-teal-deep)]" />
                {type === "percent" ? "Percent off" : "Amount off"}
              </label>
            ))}
          </div>
        </fieldset>
        {values.type === "percent" ? (
          <>
            {input("percent", "Percent off", "e.g. 10", locked, "decimal")}
            {input("maxDiscount", "Most it can take off ($)", "Optional cap, e.g. 10.00.", locked, "decimal")}
          </>
        ) : (
          input("amount", "Amount off ($)", "e.g. 5.00", locked, "decimal")
        )}
      </FormSection>
      <FormSection title="Rules">
        {input("minSpend", "Minimum spend ($)", "Blank = none.", false, "decimal")}
        <span className="hidden md:block" />
        {input("usageLimit", "Total uses", "Blank = no limit.", false, "numeric")}
        {input("perUserLimit", "Uses per customer", "Blank = no limit.", false, "numeric")}
        <HonoluluDateTimeField name="starts" label="Starts" value={starts} onChange={setStarts} hint="Blank = now." error={errors.startsAt} />
        <HonoluluDateTimeField name="ends" label="Ends" value={ends} onChange={setEnds} hint="Blank = no end." error={errors.endsAt} />
        <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2">
          <input type="checkbox" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
          <span>
            <span className="font-semibold">On</span>
            <span className="block text-muted-foreground">Untick to stop the code working, whatever its dates.</span>
          </span>
        </label>
      </FormSection>
      <FormActions>
        <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white disabled:opacity-60">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {values.id ? "Save promo" : "Create promo"}
        </button>
      </FormActions>
    </form>
  );
}

"use client";

/**
 * Create or edit a product: details, photo, price or sizes, modifier groups
 * (in order, each optionally "Only show when [option] is selected"),
 * allergens and dietary tags, catering, an optional limited-time window.
 *
 * Beside it (below it on a phone), the live preview: the customer's own
 * product sheet, built from this draft by the same function the menu uses,
 * with live prices from the shared pricing engine. Saving checks the same
 * rules again on the server and in the database.
 */
import { ArrowDown, ArrowUp, Eye, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { ProductCustomizer } from "@/components/menu/product-customizer";
import { ALLERGENS, DIETARY } from "@/components/menu/dietary";
import type { Allergen, DietaryTag } from "@/lib/menu/model";
import { saveProductAction } from "@/lib/menu-admin/actions";
import { effectiveSlug, previewDetail, validateProductDraft, type AdminGroup, type ProductDraft } from "@/lib/menu-admin/rules";
import { cafeDateKey, cafeInstant, cafeTimeKey } from "@/lib/time";
import { cn } from "@/lib/utils";

import { AdminField, FormActions, FormSection, describedBy, inputClass, textareaClass } from "./form-layout";
import { HonoluluDateTimeField, type HonoluluDateTime } from "./honolulu-datetime-field";
import { ImageUploadField } from "./image-upload-field";

let keyCounter = 0;
const newKey = () => `new-${Date.now()}-${keyCounter++}`;

const toWallClock = (iso: string | null): HonoluluDateTime => (iso ? { date: cafeDateKey(new Date(iso)), time: cafeTimeKey(new Date(iso)) } : { date: "", time: "" });
const fromWallClock = (value: HonoluluDateTime): string | null => {
  if (!value.date) return null;
  return cafeInstant(value.date, value.time || "00:00")?.toISOString() ?? null;
};

export function ProductEditor({
  initial,
  categories,
  groups,
  supabaseUrl,
}: {
  initial: ProductDraft;
  categories: { id: string; name: string; slug: string; isActive: boolean }[];
  groups: AdminGroup[];
  supabaseUrl: string;
}) {
  const id = useId();
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [limited, setLimited] = useState(Boolean(initial.availableFrom || initial.availableUntil));
  const [from, setFrom] = useState(toWallClock(initial.availableFrom));
  const [until, setUntil] = useState(toWallClock(initial.availableUntil));
  const [adding, setAdding] = useState("");

  const set = <K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const current: ProductDraft = { ...draft, availableFrom: limited ? fromWallClock(from) : null, availableUntil: limited ? fromWallClock(until) : null };
  // Live messages once the admin has tried to save.
  const shown = checked ? { ...validateProductDraft(current, groups), ...pickServerOnly(errors) } : errors;

  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const category = categories.find((c) => c.id === draft.categoryId) ?? null;
  const detail = previewDetail(current, groups, category, supabaseUrl);
  // Re-mount the preview when its structure changes, so its starting
  // choices follow (defaults, sizes, groups); prices update live.
  const previewKey = JSON.stringify([
    draft.sizes.map((s) => [s.key, s.isDefault]),
    draft.groups.map((g) => [g.groupId, g.visibleWhenOptionId]),
  ]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setChecked(true);
    const local = validateProductDraft(current, groups);
    if (limited && !current.availableFrom && !current.availableUntil) local.availableFrom = "Pick when it starts, when it ends, or both.";
    if (Object.keys(local).length) {
      setErrors(local);
      toast.error("Please check the highlighted fields.");
      return;
    }
    setPending(true);
    try {
      const result = await saveProductAction(current);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
        return;
      }
      setErrors({});
      toast.success(result.message ?? "Saved.");
      if (draft.id) router.refresh();
      else router.push(`/admin/menu/products/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  // ---- Sizes ---------------------------------------------------------------
  const updateSize = (index: number, patch: Partial<ProductDraft["sizes"][number]>) =>
    set("sizes", draft.sizes.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const moveSize = (index: number, by: -1 | 1) => {
    const next = [...draft.sizes];
    const [s] = next.splice(index, 1);
    next.splice(index + by, 0, s);
    set("sizes", next);
  };

  // ---- Groups --------------------------------------------------------------
  const linked = draft.groups.map((l) => byId.get(l.groupId)).filter((g): g is AdminGroup => Boolean(g));
  const available = groups.filter((g) => !g.archived && !draft.groups.some((l) => l.groupId === g.id));
  const moveGroup = (index: number, by: -1 | 1) => {
    const next = [...draft.groups];
    const [g] = next.splice(index, 1);
    next.splice(index + by, 0, g);
    set("groups", next);
  };
  const removeGroup = (groupId: string) => {
    const group = byId.get(groupId);
    const optionIds = new Set(group?.options.map((o) => o.id) ?? []);
    // A rule that depended on the removed group's options goes with it.
    set(
      "groups",
      draft.groups
        .filter((l) => l.groupId !== groupId)
        .map((l) => (l.visibleWhenOptionId && optionIds.has(l.visibleWhenOptionId) ? { ...l, visibleWhenOptionId: null } : l)),
    );
  };

  const toggleTag = <T extends string>(list: T[], tag: T) => (list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <form onSubmit={save} noValidate className="min-w-0 space-y-5" aria-label="Product">
        <FormSection title="The item">
          <AdminField id={`${id}-name`} label="Name" error={shown.name}>
            <input id={`${id}-name`} value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={80} aria-invalid={shown.name ? true : undefined} aria-describedby={describedBy(`${id}-name`, false, shown.name)} className={inputClass} />
          </AdminField>
          <AdminField id={`${id}-slug`} label="Web address" hint={`Leave blank to use ${effectiveSlug({ slug: "", name: draft.name }) || "one made from the name"}.`} error={shown.slug}>
            <input id={`${id}-slug`} value={draft.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} maxLength={80} aria-invalid={shown.slug ? true : undefined} aria-describedby={describedBy(`${id}-slug`, true, shown.slug)} className={inputClass} />
          </AdminField>
          <AdminField id={`${id}-category`} label="Category">
            <select id={`${id}-category`} value={draft.categoryId ?? ""} onChange={(e) => set("categoryId", e.target.value || null)} className={inputClass}>
              <option value="">No category (shown under “More to try”)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isActive ? "" : " (switched off)"}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField id={`${id}-calories`} label="Calories" hint="Optional." error={shown.calories}>
            <input id={`${id}-calories`} inputMode="numeric" value={draft.calories} onChange={(e) => set("calories", e.target.value)} aria-invalid={shown.calories ? true : undefined} className={cn(inputClass, "max-w-32")} />
          </AdminField>
          <AdminField id={`${id}-description`} label="Description" className="md:col-span-2" error={shown.description}>
            <textarea id={`${id}-description`} value={draft.description} onChange={(e) => set("description", e.target.value)} maxLength={1000} className={textareaClass} />
          </AdminField>
          <ImageUploadField
            label="Photo"
            bucket="product-images"
            supabaseUrl={supabaseUrl}
            value={draft.imagePath}
            onChange={(path) => set("imagePath", path)}
            aspect="aspect-[16/9]"
            previewAlt={draft.name || "Product photo"}
            hint="Without a photo, the menu shows a branded placeholder."
          />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={draft.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
            <span>
              <span className="font-semibold">On the menu</span>
              <span className="block text-muted-foreground">Untick to hide it from customers without archiving it.</span>
            </span>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={draft.cateringEligible} onChange={(e) => set("cateringEligible", e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
            <span>
              <span className="font-semibold">Offered for catering</span>
              <span className="block text-muted-foreground">Shown in the catering request form.</span>
            </span>
          </label>
        </FormSection>

        <FormSection title="Price" description="One price, or sizes that each have their own price. Prices are what customers pay before tax.">
          {draft.sizes.length === 0 ? (
            <AdminField id={`${id}-price`} label="Price" error={shown.basePrice}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted-foreground" aria-hidden="true">$</span>
                <input id={`${id}-price`} inputMode="decimal" value={draft.basePrice} onChange={(e) => set("basePrice", e.target.value)} aria-invalid={shown.basePrice ? true : undefined} aria-describedby={describedBy(`${id}-price`, false, shown.basePrice)} className={cn(inputClass, "max-w-32")} />
              </div>
            </AdminField>
          ) : (
            <div className="space-y-2 md:col-span-2">
              <p className="text-sm font-semibold" id={`${id}-sizes`}>
                Sizes
              </p>
              <ol className="space-y-2" aria-labelledby={`${id}-sizes`}>
                {draft.sizes.map((size, index) => (
                  <li key={size.key} className="grid gap-2 rounded-2xl border p-3 sm:grid-cols-[minmax(8rem,1fr)_7rem_5rem]" data-testid="size-row">
                    <AdminField id={`${id}-size-${size.key}-name`} label="Size" error={shown[`sizes.${index}.name`]}>
                      <input id={`${id}-size-${size.key}-name`} value={size.name} onChange={(e) => updateSize(index, { name: e.target.value })} maxLength={40} aria-invalid={shown[`sizes.${index}.name`] ? true : undefined} className={inputClass} />
                    </AdminField>
                    <AdminField id={`${id}-size-${size.key}-price`} label="Price ($)" error={shown[`sizes.${index}.price`]}>
                      <input id={`${id}-size-${size.key}-price`} inputMode="decimal" value={size.price} onChange={(e) => updateSize(index, { price: e.target.value })} aria-invalid={shown[`sizes.${index}.price`] ? true : undefined} className={inputClass} />
                    </AdminField>
                    <AdminField id={`${id}-size-${size.key}-oz`} label="Oz" error={shown[`sizes.${index}.volumeOz`]}>
                      <input id={`${id}-size-${size.key}-oz`} inputMode="numeric" value={size.volumeOz} onChange={(e) => updateSize(index, { volumeOz: e.target.value })} className={inputClass} />
                    </AdminField>
                    <div className="flex flex-wrap items-center gap-1 sm:col-span-3">
                      <label className="flex min-h-11 items-center gap-2 px-1 text-sm">
                        <input type="radio" name={`${id}-default-size`} checked={size.isDefault} onChange={() => set("sizes", draft.sizes.map((s, i) => ({ ...s, isDefault: i === index })))} className="size-5 accent-[var(--brand-teal-deep)]" />
                        Default
                      </label>
                      <span className="flex-1" aria-hidden="true" />
                      <button type="button" onClick={() => moveSize(index, -1)} disabled={index === 0} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${size.name || "size"} up`}>
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => moveSize(index, 1)} disabled={index === draft.sizes.length - 1} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${size.name || "size"} down`}>
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = draft.sizes.filter((_, i) => i !== index);
                          if (size.isDefault && next.length) next[0] = { ...next[0], isDefault: true };
                          set("sizes", next);
                        }}
                        className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border text-destructive"
                        aria-label={`Remove ${size.name || "size"}`}
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              {shown.sizes ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {shown.sizes}
                </p>
              ) : null}
            </div>
          )}
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={() =>
                set("sizes", [
                  ...draft.sizes,
                  { key: newKey(), id: null, name: draft.sizes.length === 0 ? "Regular" : "", price: draft.sizes.length === 0 ? draft.basePrice : "", volumeOz: "", isDefault: draft.sizes.length === 0 },
                ])
              }
              className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:bg-muted"
            >
              <Plus className="size-4" aria-hidden="true" />
              {draft.sizes.length === 0 ? "Use sizes instead" : "Add a size"}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">Price changes apply to new carts and orders. Carts holding this item are re-priced with a notice; past orders keep what was paid.</p>
          </div>
        </FormSection>

        <FormSection
          title="Customisation"
          description={
            <>
              Modifier groups, in the order customers see them. Groups are shared between products and edited on the{" "}
              <Link href="/admin/menu/modifiers" className="font-semibold text-brand-teal-deep underline">
                Modifiers
              </Link>{" "}
              page.
            </>
          }
        >
          <div className="space-y-2 md:col-span-2">
            {draft.groups.length === 0 ? <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No customisation: customers just pick a size and quantity.</p> : null}
            <ol className="space-y-2" aria-label="Modifier groups on this product">
              {draft.groups.map((link, index) => {
                const group = byId.get(link.groupId);
                const others = linked.filter((g) => g.id !== link.groupId);
                const whenError = shown[`groups.${index}.visibleWhen`];
                return (
                  <li key={link.groupId} className="rounded-2xl border p-3" data-testid="linked-group">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-sm font-semibold">
                        {group?.name ?? "Removed group"}
                        {group ? (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {group.selectionType === "single" ? "Choose one" : "Choose any"}
                            {group.isRequired ? " · required" : ""}
                            {!group.isActive ? " · switched off" : ""}
                          </span>
                        ) : null}
                      </span>
                      <button type="button" onClick={() => moveGroup(index, -1)} disabled={index === 0} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${group?.name ?? "group"} up`}>
                        <ArrowUp className="size-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => moveGroup(index, 1)} disabled={index === draft.groups.length - 1} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border disabled:opacity-40" aria-label={`Move ${group?.name ?? "group"} down`}>
                        <ArrowDown className="size-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => removeGroup(link.groupId)} className="focus-ring inline-flex size-11 items-center justify-center rounded-lg border text-destructive" aria-label={`Remove ${group?.name ?? "group"}`}>
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <AdminField id={`${id}-when-${link.groupId}`} label="Only show when" className="mt-2" error={whenError ?? shown[`groups.${index}`]}>
                      <select
                        id={`${id}-when-${link.groupId}`}
                        value={link.visibleWhenOptionId ?? ""}
                        onChange={(e) => set("groups", draft.groups.map((l, i) => (i === index ? { ...l, visibleWhenOptionId: e.target.value || null } : l)))}
                        aria-invalid={whenError ? true : undefined}
                        className={inputClass}
                      >
                        <option value="">Always show</option>
                        {others.map((g) => (
                          <optgroup key={g.id} label={g.name}>
                            {g.options
                              .filter((o) => !o.archived)
                              .map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.name} is selected
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    </AdminField>
                  </li>
                );
              })}
            </ol>
            <div className="flex flex-wrap items-end gap-2">
              <AdminField id={`${id}-add-group`} label="Add a group" className="min-w-0 flex-1">
                <select id={`${id}-add-group`} value={adding} onChange={(e) => setAdding(e.target.value)} className={inputClass}>
                  <option value="">Choose a group…</option>
                  {available.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.slug})
                    </option>
                  ))}
                </select>
              </AdminField>
              <button
                type="button"
                disabled={!adding}
                onClick={() => {
                  set("groups", [...draft.groups, { groupId: adding, visibleWhenOptionId: null }]);
                  setAdding("");
                }}
                className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add group
              </button>
            </div>
          </div>
        </FormSection>

        <FormSection title="Allergens and dietary tags" description="Shown on the menu card and the product sheet. Options carry their own allergens (on the Modifiers page).">
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-semibold">Contains</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(ALLERGENS) as Allergen[]).map((tag) => (
                <label key={tag} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm", draft.allergens.includes(tag) && "border-brand-teal-deep bg-brand-teal-soft")}>
                  <input type="checkbox" checked={draft.allergens.includes(tag)} onChange={() => set("allergens", toggleTag(draft.allergens, tag))} className="size-4 accent-[var(--brand-teal-deep)]" />
                  {ALLERGENS[tag].label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-semibold">Dietary</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(Object.keys(DIETARY) as DietaryTag[]).map((tag) => (
                <label key={tag} className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm", draft.dietaryTags.includes(tag) && "border-brand-teal-deep bg-brand-teal-soft")}>
                  <input type="checkbox" checked={draft.dietaryTags.includes(tag)} onChange={() => set("dietaryTags", toggleTag(draft.dietaryTags, tag))} className="size-4 accent-[var(--brand-teal-deep)]" />
                  {DIETARY[tag].label}
                </label>
              ))}
            </div>
          </fieldset>
        </FormSection>

        <FormSection title="Availability window" description="For seasonal or limited-time items: on the menu only between these times (Honolulu). Collections can set this too.">
          <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2">
            <input type="checkbox" checked={limited} onChange={(e) => setLimited(e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
            <span className="font-semibold">Limited time</span>
          </label>
          {limited ? (
            <>
              <HonoluluDateTimeField name="availableFrom" label="From" value={from} onChange={setFrom} error={shown.availableFrom} hint="Blank = no start." />
              <HonoluluDateTimeField name="availableUntil" label="Until" value={until} onChange={setUntil} error={shown.availableUntil} hint="Blank = no end." />
            </>
          ) : null}
        </FormSection>

        <FormActions note={Object.keys(shown).length ? <span className="text-destructive">Some fields need attention.</span> : undefined}>
          <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white disabled:opacity-60">
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {draft.id ? "Save product" : "Create product"}
          </button>
        </FormActions>
      </form>

      <aside aria-labelledby={`${id}-preview`} className="min-w-0 xl:sticky xl:top-4 xl:self-start">
        <div className="rounded-3xl border bg-background p-4">
          <h2 id={`${id}-preview`} className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
            <Eye className="size-4" aria-hidden="true" />
            Live preview
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">Exactly what customers see, with live prices. Try the choices; nothing is added to a cart.</p>
          <div data-testid="product-preview" className="max-h-[80vh] overflow-y-auto rounded-2xl border bg-card px-4 pt-4">
            {detail ? (
              <ProductCustomizer
                key={previewKey}
                detail={detail}
                location={{ id: "preview", name: "the cafe" }}
                ordering={{ canOrder: true, reason: null }}
                layout="page"
                preview
              />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Give the product a name to see it.</p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Errors only the server can find (a taken web address), kept while live checks refresh. */
function pickServerOnly(errors: Record<string, string>): Record<string, string> {
  return errors.slug?.includes("Another product") ? { slug: errors.slug } : {};
}

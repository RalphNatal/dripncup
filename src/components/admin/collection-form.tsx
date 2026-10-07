"use client";

/**
 * Create or edit a seasonal collection, with a live preview of the banner
 * exactly as the menu and Home show it.
 *
 * The accent colour is decoration only (the banner's stripe, a soft circle,
 * a tinted border): text never sits on it, so any colour stays readable.
 * When the colour would fail WCAG AA as text the form says so, so nobody is
 * tempted to use it that way.
 */
import { AlertTriangle, CheckCircle2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";

import { AdminField, FormActions, FormSection, describedBy, inputClass, textareaClass } from "@/components/admin/form-layout";
import { HonoluluDateTimeField, type HonoluluDateTime } from "@/components/admin/honolulu-datetime-field";
import { ImageUploadField } from "@/components/admin/image-upload-field";
import { ProductPicker } from "@/components/admin/product-picker";
import { CollectionBanner } from "@/components/menu/banners";
import { saveCollectionAction } from "@/lib/collections/admin-actions";
import { checkAccentColor, formatRatio, normalizeHexColor } from "@/lib/collections/contrast";
import type { CollectionFormInput } from "@/lib/collections/schemas";
import type { PickerProduct } from "@/lib/events/queries";
import { publicStorageUrl } from "@/lib/menu/images";
import { formatCafeDate } from "@/lib/time";

export interface CollectionFormValues {
  name: string;
  slug: string;
  description: string;
  bannerPath: string | null;
  accentColor: string;
  starts: HonoluluDateTime;
  ends: HonoluluDateTime;
  isActive: boolean;
  products: { productId: string; limited: boolean }[];
}

export function CollectionForm({
  collectionId,
  initial,
  products,
  supabaseUrl,
}: {
  collectionId: string | null;
  initial: CollectionFormValues;
  products: PickerProduct[];
  supabaseUrl: string;
}) {
  const id = useId();
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const set = <K extends keyof CollectionFormValues>(key: K, value: CollectionFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const hex = normalizeHexColor(values.accentColor);
  const contrast = hex ? checkAccentColor(hex) : null;
  const byId = new Map(products.map((p) => [p.id, p]));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const input: CollectionFormInput = {
        id: collectionId,
        name: values.name,
        slug: values.slug,
        description: values.description,
        bannerPath: values.bannerPath,
        accentColor: values.accentColor.trim(),
        startDate: values.starts.date,
        startTime: values.starts.time,
        endDate: values.ends.date,
        endTime: values.ends.time,
        isActive: values.isActive,
        products: values.products,
      };
      const result = await saveCollectionAction(input);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
        return;
      }
      toast.success(collectionId ? "Collection saved." : "Collection created.");
      if (collectionId) router.refresh();
      else router.push(`/admin/collections/${result.id}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5">
      <FormSection title="The collection">
        <AdminField id={`${id}-name`} label="Name" error={errors.name}>
          <input id={`${id}-name`} value={values.name} onChange={(e) => set("name", e.target.value)} maxLength={80} aria-invalid={errors.name ? true : undefined} className={inputClass} />
        </AdminField>
        <AdminField id={`${id}-slug`} label="Web address" hint="Leave blank to make one from the name." error={errors.slug}>
          <input
            id={`${id}-slug`}
            value={values.slug}
            onChange={(e) => set("slug", e.target.value)}
            maxLength={80}
            aria-invalid={errors.slug ? true : undefined}
            aria-describedby={describedBy(`${id}-slug`, true, errors.slug)}
            className={inputClass}
          />
        </AdminField>
        <AdminField id={`${id}-description`} label="Description" className="md:col-span-2" error={errors.description}>
          <textarea id={`${id}-description`} value={values.description} onChange={(e) => set("description", e.target.value)} maxLength={500} className={textareaClass} />
        </AdminField>
        <label className="flex min-h-11 items-center gap-3 text-sm md:col-span-2">
          <input type="checkbox" checked={values.isActive} onChange={(e) => set("isActive", e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
          <span>
            <span className="font-semibold">Active</span>
            <span className="block text-muted-foreground">Untick to hide it whatever its dates say.</span>
          </span>
        </label>
      </FormSection>

      <FormSection title="When" description="Shown on the menu and Home from the start to the end, automatically.">
        <HonoluluDateTimeField name="starts" label="Starts" value={values.starts} onChange={(v) => set("starts", v)} error={errors.startDate} />
        <HonoluluDateTimeField name="ends" label="Ends" value={values.ends} onChange={(v) => set("ends", v)} error={errors.endDate} />
      </FormSection>

      <FormSection title="Look">
        <ImageUploadField
          label="Banner image"
          bucket="collection-banners"
          supabaseUrl={supabaseUrl}
          value={values.bannerPath}
          onChange={(path) => set("bannerPath", path)}
          previewAlt={`${values.name || "Collection"} banner`}
          aspect="aspect-[4/1]"
          hint={
            <>
              <strong>Artwork must be Drincup&apos;s own</strong>: no third-party characters, logos or trademarks. JPEG, PNG or WebP, up to 5 MB, about 4:1 (e.g.
              2400 × 600). Location data and other metadata are removed on upload.
            </>
          }
        />
        <div className="space-y-1.5 md:col-span-2">
          <label htmlFor={`${id}-accent`} className="block text-sm font-semibold">
            Accent colour (optional)
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              value={hex ?? "#E0409B"}
              onChange={(e) => set("accentColor", e.target.value.toUpperCase())}
              className="h-11 w-14 cursor-pointer rounded-xl border bg-background p-1"
              aria-label="Pick the accent colour"
            />
            <input
              id={`${id}-accent`}
              value={values.accentColor}
              onChange={(e) => set("accentColor", e.target.value)}
              placeholder="#E0409B (blank = brand magenta)"
              maxLength={7}
              aria-invalid={errors.accentColor || (values.accentColor && !hex) ? true : undefined}
              aria-describedby={`${id}-accent-status`}
              className={`${inputClass} max-w-56 font-mono`}
            />
            {values.accentColor ? (
              <button type="button" onClick={() => set("accentColor", "")} className="focus-ring min-h-11 rounded-xl border px-3 text-sm font-semibold hover:bg-muted">
                Use the brand accent
              </button>
            ) : null}
          </div>
          <div id={`${id}-accent-status`} aria-live="polite" className="text-sm">
            {errors.accentColor ? (
              <p className="font-medium text-destructive">{errors.accentColor}</p>
            ) : values.accentColor && !hex ? (
              <p className="font-medium text-destructive">Use a colour like #E0409B.</p>
            ) : contrast && !contrast.passesForText ? (
              <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-[color-mix(in_oklab,var(--warning)_8%,var(--card))] p-2" data-testid="accent-contrast-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                <span>
                  This colour has {formatRatio(contrast.ratio)} contrast against white, below the 4.5:1 text needs. That&apos;s fine here: the banner uses it only for
                  decoration and large fills, never behind or as text.
                </span>
              </p>
            ) : contrast ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="size-4 text-brand-teal-deep" aria-hidden="true" />
                {formatRatio(contrast.ratio)} contrast against white. The banner still uses it for decoration only.
              </p>
            ) : (
              <p className="text-muted-foreground">Blank uses the brand&apos;s magenta.</p>
            )}
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Products"
        description="In the order they appear. Tick “Limited time” to sell a product only while this collection runs; it then appears and disappears from the menu, cart and checkout by itself."
      >
        <ProductPicker
          label="Products in this collection"
          products={products}
          selected={values.products.map((p) => p.productId)}
          onChange={(ids) => set("products", ids.map((productId) => values.products.find((p) => p.productId === productId) ?? { productId, limited: false }))}
          error={errors.products}
          extra={(product) => {
            const row = values.products.find((p) => p.productId === product.id);
            const otherWindow = !row?.limited && (product.availableFrom || product.availableUntil);
            return (
              <span className="flex flex-col items-start">
                <label className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={row?.limited ?? false}
                    onChange={(e) => set("products", values.products.map((p) => (p.productId === product.id ? { ...p, limited: e.target.checked } : p)))}
                    className="size-4 accent-[var(--brand-teal-deep)]"
                  />
                  Limited time
                </label>
                {otherWindow ? (
                  <span className="text-xs text-muted-foreground">
                    Own window: {product.availableFrom ? formatCafeDate(new Date(product.availableFrom)) : "…"} –{" "}
                    {product.availableUntil ? formatCafeDate(new Date(product.availableUntil)) : "…"}
                  </span>
                ) : null}
              </span>
            );
          }}
        />
      </FormSection>

      <section className="space-y-2" aria-labelledby={`${id}-preview`}>
        <h2 id={`${id}-preview`} className="text-lg font-bold">
          Preview
        </h2>
        <p className="text-sm text-muted-foreground">How the banner looks on the menu and Home (before saving).</p>
        <div data-testid="collection-preview">
          <CollectionBanner
            collection={{
              id: collectionId ?? "preview",
              slug: values.slug || "preview",
              name: values.name || "Collection name",
              description: values.description || null,
              accentColor: hex,
              bannerImageUrl: values.bannerPath ? publicStorageUrl(supabaseUrl, "collection-banners", values.bannerPath) : null,
              products: values.products.flatMap((p) => {
                const product = byId.get(p.productId);
                return product ? [{ slug: product.slug, name: product.name }] : [];
              }),
            }}
          />
        </div>
      </section>

      <FormActions>
        <button type="submit" disabled={pending} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-sm font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Saving…" : collectionId ? "Save changes" : "Create collection"}
        </button>
      </FormActions>
    </form>
  );
}

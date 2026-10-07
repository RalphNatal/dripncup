"use client";

/**
 * The admin's quote builder: menu lines (prefilled at the menu price,
 * editable for catering pricing) and custom lines, a delivery fee, an
 * optional discount and gratuity, the expiry and a note. The totals shown
 * are calculateCateringQuote's -- the same function the server runs when the
 * quote is sent, so what the admin sees is what is stored and charged.
 */
import { LoaderCircle, Plus, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AdminField, inputClass, textareaClass } from "@/components/admin/form-layout";
import { HonoluluDateTimeField, type HonoluluDateTime } from "@/components/admin/honolulu-datetime-field";
import { issueQuoteAction } from "@/lib/catering/admin-actions";
import { quoteRows } from "@/lib/catering/format";
import { toDollars, type DraftLine } from "@/lib/catering/quote-draft";
import type { PickerProduct } from "@/lib/events/queries";
import { formatCents } from "@/lib/money";
import { calculateCateringQuote, type CateringQuoteInput } from "@/lib/pricing";
import { cafeInstant } from "@/lib/time";
import { cn } from "@/lib/utils";

let seq = 0;
const draftKey = () => `line-${++seq}`;

const toCents = (dollars: string) => {
  const value = Number(dollars.replace(/[$,\s]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : NaN;
};

export function QuoteBuilder({
  requestId,
  isDelivery,
  products,
  initialLines,
  initialDeliveryFeeCents,
  initialExpiry,
  deadlineLabel,
  minExpiryDate,
  settings,
  revision,
}: {
  requestId: string;
  isDelivery: boolean;
  products: PickerProduct[];
  initialLines: DraftLine[];
  initialDeliveryFeeCents: number;
  initialExpiry: HonoluluDateTime;
  deadlineLabel: string;
  minExpiryDate: string;
  settings: { taxRate: number; deliveryFeeTaxable: boolean; gratuityTaxable: boolean };
  revision: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[]>(initialLines);
  const [deliveryFee, setDeliveryFee] = useState(toDollars(initialDeliveryFeeCents));
  const [discountKind, setDiscountKind] = useState<"none" | "amount" | "percent">("none");
  const [discountValue, setDiscountValue] = useState("");
  const [discountLabel, setDiscountLabel] = useState("");
  const [gratuityOn, setGratuityOn] = useState(false);
  const [gratuityPercent, setGratuityPercent] = useState("15");
  const [expiry, setExpiry] = useState(initialExpiry);
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const input: CateringQuoteInput = {
    lines: lines.map((l) => ({ kind: l.kind, description: l.description, quantity: Number(l.quantity), unitPriceCents: toCents(l.unitPrice) })),
    deliveryFeeCents: isDelivery ? toCents(deliveryFee) : 0,
    deliveryFeeTaxable: settings.deliveryFeeTaxable,
    discount:
      discountKind === "amount"
        ? { kind: "amount", amountCents: toCents(discountValue), label: discountLabel || null }
        : discountKind === "percent"
          ? { kind: "percent", percent: Number(discountValue), label: discountLabel || null }
          : null,
    gratuity: gratuityOn ? { kind: "percent", percent: Number(gratuityPercent) } : null,
    gratuityTaxable: settings.gratuityTaxable,
    taxRate: settings.taxRate,
  };
  const preview = calculateCateringQuote(input);
  const previewProblems = preview.ok ? {} : Object.fromEntries(preview.problems.map((p) => [p.field, p.message]));

  function addProduct(productId: string) {
    const product = byId.get(productId);
    if (!product) return;
    const size = product.sizes[0] ?? null;
    setLines((rows) => [
      ...rows,
      {
        key: draftKey(),
        kind: "product",
        productId,
        sizeId: size?.id ?? null,
        description: product.name,
        quantity: "1",
        unitPrice: toDollars(size?.priceCents ?? product.basePriceCents),
      },
    ]);
    setAdding("");
  }

  function update(key: string, patch: Partial<DraftLine>) {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function send() {
    setErrors({});
    const expiresAt = cafeInstant(expiry.date, expiry.time);
    if (!preview.ok || !expiresAt) {
      setErrors({ ...previewProblems, ...(expiresAt ? {} : { expiresAt: "Pick an expiry date and time." }) });
      toast.error("Please check the quote.");
      return;
    }
    setPending(true);
    try {
      const result = await issueQuoteAction({
        requestId,
        lines: lines.map((l) =>
          l.kind === "product"
            ? { kind: "product", productId: l.productId!, sizeId: l.sizeId, description: l.description, quantity: Number(l.quantity), unitPriceCents: toCents(l.unitPrice) }
            : { kind: "custom", description: l.description, quantity: Number(l.quantity), unitPriceCents: toCents(l.unitPrice) },
        ),
        deliveryFeeCents: isDelivery ? toCents(deliveryFee) : 0,
        discount:
          discountKind === "amount"
            ? { kind: "amount", amountCents: toCents(discountValue), label: discountLabel }
            : discountKind === "percent"
              ? { kind: "percent", percent: Number(discountValue), label: discountLabel }
              : null,
        gratuity: gratuityOn ? { kind: "percent", percent: Number(gratuityPercent) } : null,
        expiresAt: expiresAt.toISOString(),
        noteToCustomer: note,
      });
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message);
        return;
      }
      toast.success(`Quote v${result.version} sent: ${formatCents(result.totalCents)}. The customer has been emailed.`);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-5 rounded-3xl border bg-card p-5" aria-labelledby="quote-builder-title" data-testid="quote-builder">
      <div>
        <h2 id="quote-builder-title" className="text-lg font-bold">
          {revision ? "Revise the quote" : "Build a quote"}
        </h2>
        <p className="text-sm text-muted-foreground">
          Menu prices are filled in; change them for catering pricing. Totals are worked out exactly as they will be charged.
        </p>
      </div>

      <ul className="space-y-3" aria-label="Quote lines">
        {lines.map((line, index) => {
          const product = line.productId ? byId.get(line.productId) : null;
          const lineError = errors[`lines.${index}`] ?? previewProblems[`lines.${index}`];
          return (
            <li key={line.key} className="rounded-2xl border p-3" data-testid="quote-line">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6rem_8rem_auto] sm:items-end">
                <label className="space-y-1 text-sm">
                  <span className="block font-semibold">{line.kind === "product" ? `Menu item${product ? "" : " (removed)"}` : "Custom line"}</span>
                  <input
                    value={line.description}
                    onChange={(e) => update(line.key, { description: e.target.value })}
                    maxLength={200}
                    className={inputClass}
                    aria-label={`Line ${index + 1} description`}
                  />
                </label>
                {product && product.sizes.length > 0 ? (
                  <label className="space-y-1 text-sm">
                    <span className="block font-semibold">Size</span>
                    <select
                      value={line.sizeId ?? ""}
                      onChange={(e) => {
                        const size = product.sizes.find((s) => s.id === e.target.value);
                        update(line.key, { sizeId: e.target.value, unitPrice: size ? toDollars(size.priceCents) : line.unitPrice });
                      }}
                      className={inputClass}
                      aria-label={`Line ${index + 1} size`}
                    >
                      {product.sizes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="hidden sm:block" />
                )}
                <label className="space-y-1 text-sm">
                  <span className="block font-semibold">Qty</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={line.quantity}
                    onChange={(e) => update(line.key, { quantity: e.target.value })}
                    className={inputClass}
                    aria-label={`Line ${index + 1} quantity`}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block font-semibold">Unit price ($)</span>
                  <input
                    inputMode="decimal"
                    value={line.unitPrice}
                    onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                    className={inputClass}
                    aria-label={`Line ${index + 1} unit price in dollars`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setLines((rows) => rows.filter((r) => r.key !== line.key))}
                  className="focus-ring inline-flex size-11 items-center justify-center rounded-xl border text-muted-foreground hover:text-destructive"
                  aria-label={`Remove line ${index + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              {lineError ? (
                <p className="mt-2 text-sm font-medium text-destructive" role="alert">
                  {lineError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {errors.lines ?? previewProblems.lines ? (
        <p className="text-sm font-medium text-destructive" role="alert">
          {errors.lines ?? previewProblems.lines}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          <span className="block font-semibold">Add a menu item</span>
          <select value={adding} onChange={(e) => setAdding(e.target.value)} className={inputClass}>
            <option value="">Choose…</option>
            {products
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isCateringEligible ? "" : " (not on the catering menu)"}
                </option>
              ))}
          </select>
        </label>
        <button type="button" onClick={() => addProduct(adding)} disabled={!adding} className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-xl border px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50">
          <Plus className="size-4" aria-hidden="true" />
          Add item
        </button>
        <button
          type="button"
          onClick={() => setLines((rows) => [...rows, { key: draftKey(), kind: "custom", productId: null, sizeId: null, description: "", quantity: "1", unitPrice: "0.00" }])}
          className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-xl border px-3 text-sm font-semibold hover:bg-muted"
        >
          <Plus className="size-4" aria-hidden="true" />
          Custom line
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {isDelivery ? (
          <AdminField id="quote-delivery-fee" label="Delivery fee ($)" hint={settings.deliveryFeeTaxable ? "GET is charged on it (setting)." : "No GET on it (setting)."} error={errors.deliveryFeeCents ?? previewProblems.deliveryFee}>
            <input id="quote-delivery-fee" inputMode="decimal" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} className={inputClass} />
          </AdminField>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Discount</legend>
          <div className="flex flex-wrap gap-2">
            {(["none", "amount", "percent"] as const).map((kind) => (
              <label key={kind} className={cn("inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm", discountKind === kind && "border-brand-teal-deep bg-brand-teal-soft")}>
                <input type="radio" name="discountKind" checked={discountKind === kind} onChange={() => setDiscountKind(kind)} className="accent-[var(--brand-teal-deep)]" />
                {kind === "none" ? "None" : kind === "amount" ? "Amount ($)" : "Percent (%)"}
              </label>
            ))}
          </div>
          {discountKind !== "none" ? (
            <div className="grid grid-cols-[8rem_1fr] gap-2">
              <input inputMode="decimal" value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className={inputClass} aria-label={discountKind === "amount" ? "Discount in dollars" : "Discount percent"} />
              <input value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} maxLength={80} placeholder="Label, e.g. Repeat client" className={inputClass} aria-label="Discount label" />
            </div>
          ) : null}
          {previewProblems.discount ? <p className="text-sm font-medium text-destructive">{previewProblems.discount}</p> : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Gratuity</legend>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={gratuityOn} onChange={(e) => setGratuityOn(e.target.checked)} className="size-5 accent-[var(--brand-teal-deep)]" />
            Add a gratuity line
          </label>
          {gratuityOn ? (
            <div className="flex items-center gap-2">
              <input inputMode="decimal" value={gratuityPercent} onChange={(e) => setGratuityPercent(e.target.value)} className={cn(inputClass, "w-24")} aria-label="Gratuity percent" />
              <span className="text-sm text-muted-foreground">% of the items after discount{settings.gratuityTaxable ? ", taxed" : ", not taxed"}</span>
            </div>
          ) : null}
          {previewProblems.gratuity ? <p className="text-sm font-medium text-destructive">{previewProblems.gratuity}</p> : null}
        </fieldset>

        <HonoluluDateTimeField
          name="expiry"
          label="Quote expires"
          value={expiry}
          onChange={setExpiry}
          minDate={minExpiryDate}
          hint={`Never later than the payment deadline: ${deadlineLabel}.`}
          error={errors.expiresAt}
        />

        <AdminField id="quote-note" label="Note to the customer (optional)" className="md:col-span-2">
          <textarea id="quote-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className={textareaClass} />
        </AdminField>
      </div>

      <div className="rounded-2xl bg-muted/50 p-4" aria-live="polite">
        <p className="mb-2 text-sm font-semibold">Preview</p>
        {preview.ok ? (
          <dl className="space-y-1 text-sm" data-testid="quote-preview">
            {quoteRows({ ...preview.breakdown, discountLabel: preview.breakdown.discountLabel }).map((row) => (
              <div key={row.label} className={cn("flex justify-between", row.strong && "text-base font-extrabold")}>
                <dt>{row.label}</dt>
                <dd className="tabular">{row.amount}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Fix the highlighted lines to see the totals.</p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void send()}
        disabled={pending}
        className="focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
      >
        {pending ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Send className="size-5" aria-hidden="true" />}
        {pending ? "Sending…" : revision ? "Send revised quote" : "Send quote"}
      </button>
    </section>
  );
}

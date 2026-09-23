"use client";

/**
 * Product customisation: size, then every modifier group the product links
 * to, rendered from data --
 *   single-select                 -> radio buttons
 *   multi-select                  -> checkboxes; an option allowing more than
 *                                    one unit gets a +/- stepper (pumps)
 *   one option, several units     -> a bare +/- stepper (extra shots)
 * Conditional groups appear only while their controlling option is chosen.
 *
 * Validation and prices come from the shared engine (@/lib/pricing), the same
 * code checkout runs on the server.
 */
import { CircleAlert, Minus, Plus } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { DietaryChips, allergenSentence } from "@/components/menu/dietary";
import { ProductImage } from "@/components/menu/product-image";
import { useCartStore } from "@/lib/cart/store";
import type { DetailGroup, DetailOption, ProductDetail } from "@/lib/menu/model";
import type { OrderingState } from "@/lib/menu/queries";
import { formatCents, formatPriceDelta } from "@/lib/money";
import {
  MAX_LINE_QUANTITY,
  SPECIAL_INSTRUCTIONS_MAX,
  calculateUnitPrice,
  defaultSelection,
  describeSelection,
  pluralUnit,
  pruneSelection,
  resolveSelection,
  startingPriceCents,
  validateSelection,
  visibleGroupIds,
  type ModifierSelection,
} from "@/lib/pricing";
import { cn } from "@/lib/utils";

export interface ProductCustomizerProps {
  detail: ProductDetail;
  location: { id: string; name: string };
  ordering: OrderingState;
  /** "sheet" inside the dialog (scrolls internally), "page" for a shared link. */
  layout: "sheet" | "page";
  /** Called after a successful add; the sheet closes itself with it. */
  onAdded?: () => void;
}

/** "Required", "Optional · up to 3", "Required · at least 2". */
function requirementLabel(group: DetailGroup): string {
  const parts = [group.required ? "Required" : "Optional"];
  if (group.selectionType === "multi") {
    if (group.minSelections > 1) parts.push(`at least ${group.minSelections}`);
    if (group.maxSelections !== null && group.maxSelections > 1) parts.push(`up to ${group.maxSelections}`);
  }
  return parts.join(" · ");
}

/** "+$1.00 each" for per-unit charges, "+$0.75" otherwise. */
function optionPrice(group: DetailGroup, option: DetailOption): string {
  const delta = formatPriceDelta(option.priceDeltaCents);
  if (!delta) return "";
  return group.chargePerQuantity && option.maxQuantity > 1 ? `${delta} each` : delta;
}

const isStepperOnly = (group: DetailGroup) =>
  group.selectionType === "multi" && group.options.length === 1 && group.options[0].maxQuantity > 1;

export function ProductCustomizer({ detail, location, ordering, layout, onAdded }: ProductCustomizerProps) {
  const { product, groups } = detail;
  const uid = useId();
  const addLine = useCartStore((state) => state.addLine);

  const [initial] = useState(() => defaultSelection(product, groups));
  const [sizeId, setSizeId] = useState(initial.sizeId);
  const [modifiers, setModifiers] = useState<ModifierSelection>(initial.modifiers);
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");
  /** Inline errors appear after the first Add attempt, then track every change. */
  const [attempted, setAttempted] = useState(false);
  /** Price announcements start with the customer's first change, not on open. */
  const [touched, setTouched] = useState(false);

  const visible = useMemo(() => visibleGroupIds(groups, modifiers), [groups, modifiers]);
  const errors = useMemo(
    () => validateSelection(product, groups, { sizeId, modifiers, specialInstructions: instructions }),
    [product, groups, sizeId, modifiers, instructions],
  );
  const size = product.sizes.find((s) => s.id === sizeId) ?? null;
  const resolved = useMemo(() => resolveSelection(groups, modifiers), [groups, modifiers]);
  const unitPrice = calculateUnitPrice(product, size, resolved);
  const total = unitPrice * quantity;

  const groupErrors = new Map<string, string>();
  for (const error of errors) {
    if (error.groupId && !groupErrors.has(error.groupId)) groupErrors.set(error.groupId, error.message);
  }
  const sizeError = errors.find((e) => e.code === "size_required" || e.code === "unknown_size")?.message;

  // Why Add to Cart is off, most fundamental first.
  const blockedReason = product.soldOut
    ? `${product.name} is sold out at ${location.name} right now.`
    : !detail.onLocationMenu
      ? `${product.name} isn't on the menu at ${location.name}.`
      : !ordering.canOrder
        ? (ordering.reason ?? `${location.name} isn't taking orders right now.`)
        : null;

  // ---- Changes ------------------------------------------------------------
  const change = (update: (current: ModifierSelection) => ModifierSelection) => {
    setModifiers(update);
    setTouched(true);
  };

  const chooseSingle = (groupId: string, optionId: string) => change((m) => ({ ...m, [groupId]: { [optionId]: 1 } }));

  const setOptionQuantity = (groupId: string, optionId: string, next: number) =>
    change((m) => {
      const group = { ...(m[groupId] ?? {}) };
      if (next <= 0) delete group[optionId];
      else group[optionId] = next;
      return { ...m, [groupId]: group };
    });

  const chosenCount = (groupId: string) => Object.values(modifiers[groupId] ?? {}).filter((q) => q > 0).length;
  const quantityOf = (groupId: string, optionId: string) => modifiers[groupId]?.[optionId] ?? 0;

  function focusFirstProblem() {
    const first = errors[0];
    const container = document.getElementById(first?.groupId ? `${uid}-group-${first.groupId}` : `${uid}-size`);
    if (!container) return;
    container.scrollIntoView({ block: "center", behavior: "smooth" });
    container.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)")?.focus({ preventScroll: true });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedReason) return;

    if (errors.length > 0) {
      setAttempted(true);
      focusFirstProblem();
      return;
    }

    addLine({
      locationId: location.id,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      sizeId: size?.id ?? null,
      sizeName: size?.name ?? null,
      selection: pruneSelection(groups, modifiers),
      summary: describeSelection(size?.name ?? null, resolved),
      specialInstructions: instructions.trim(),
      quantity,
      unitPriceCents: unitPrice,
    });
    toast.success(`Added ${quantity > 1 ? `${quantity} × ` : ""}${product.name} to your cart`);
    onAdded?.();
  }

  // ---- Pieces ---------------------------------------------------------------
  const titleClass = "text-3xl leading-tight font-extrabold";
  const title =
    layout === "sheet" ? (
      <DialogPrimitive.Title className={titleClass}>{product.name}</DialogPrimitive.Title>
    ) : (
      <h1 className={titleClass}>{product.name}</h1>
    );
  const description = product.description ? (
    layout === "sheet" ? (
      <DialogPrimitive.Description className="mt-1 text-base text-muted-foreground">{product.description}</DialogPrimitive.Description>
    ) : (
      <p className="mt-1 text-base text-muted-foreground">{product.description}</p>
    )
  ) : null;

  const priceFrom = startingPriceCents(product);
  const pricesVary = new Set(product.sizes.map((s) => s.priceCents)).size > 1;

  const body = (
    <>
      <ProductImage
        src={product.imageUrl}
        alt={product.name}
        seed={product.slug}
        sizes="(min-width: 768px) 42rem, 100vw"
        priority
        className={cn("aspect-[16/9] w-full", layout === "page" && "rounded-3xl")}
      />

      <div className={cn("space-y-7 pt-4 pb-6", layout === "sheet" && "px-5")}>
        <div>
          {product.categoryName ? (
            <p className="text-xs font-bold tracking-wide text-brand-magenta-deep uppercase">{product.categoryName}</p>
          ) : null}
          {title}
          {description}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-base font-semibold">
            <span className="tabular">
              {pricesVary ? "From " : ""}
              {formatCents(priceFrom)}
            </span>
            {product.calories !== null ? (
              <span className="text-sm font-normal text-muted-foreground">· {product.calories} cal</span>
            ) : null}
            {product.soldOut ? (
              <span className="rounded-full bg-foreground px-2.5 py-0.5 text-xs font-bold text-background">Sold out</span>
            ) : null}
          </p>
          <div className="mt-3">
            <DietaryChips allergens={product.allergens} dietaryTags={product.dietaryTags} />
          </div>
        </div>

        {product.sizes.length > 0 ? (
          <Fieldset
            id={`${uid}-size`}
            legend="Size"
            hint="Required"
            error={attempted ? sizeError : undefined}
          >
            {product.sizes.map((s) => (
              <OptionRow key={s.id} checked={sizeId === s.id}>
                <input
                  type="radio"
                  name={`${uid}-size`}
                  value={s.id}
                  checked={sizeId === s.id}
                  onChange={() => {
                    setSizeId(s.id);
                    setTouched(true);
                  }}
                  className={NATIVE_INPUT}
                />
                <span className="flex-1">
                  <span className="font-semibold">{s.name}</span>
                  {s.volumeOz ? <span className="text-muted-foreground"> · {s.volumeOz} oz</span> : null}
                </span>
                <span className="tabular text-sm font-semibold">{formatCents(s.priceCents)}</span>
              </OptionRow>
            ))}
          </Fieldset>
        ) : null}

        {groups.map((group) => {
          if (!visible.has(group.id)) return null;
          const error = attempted ? groupErrors.get(group.id) : undefined;
          const maxReached =
            group.selectionType === "multi" &&
            group.maxSelections !== null &&
            chosenCount(group.id) >= group.maxSelections;

          return (
            <Fieldset
              key={group.id}
              id={`${uid}-group-${group.id}`}
              legend={group.name}
              hint={requirementLabel(group)}
              description={group.description}
              error={error}
            >
              {group.options.map((option) => {
                const allergens = allergenSentence(option.allergens);
                const price = optionPrice(group, option);
                const qty = quantityOf(group.id, option.id);
                const label = (
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{option.name}</span>
                    {option.soldOut ? (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">
                        Sold out
                      </span>
                    ) : null}
                    {allergens ? <span className="block text-xs text-muted-foreground">{allergens}</span> : null}
                  </span>
                );

                if (group.selectionType === "single") {
                  return (
                    <OptionRow key={option.id} checked={qty > 0} disabled={option.soldOut}>
                      <input
                        type="radio"
                        name={`${uid}-${group.id}`}
                        value={option.id}
                        checked={qty > 0}
                        disabled={option.soldOut}
                        onChange={() => chooseSingle(group.id, option.id)}
                        className={NATIVE_INPUT}
                      />
                      {label}
                      {price ? <span className="tabular text-sm text-muted-foreground">{price}</span> : null}
                    </OptionRow>
                  );
                }

                const unit = group.quantityUnit;
                if (isStepperOnly(group)) {
                  return (
                    <div key={option.id} className="flex min-h-14 items-center gap-3 px-4 py-2">
                      {label}
                      {price ? <span className="tabular text-sm text-muted-foreground">{price}</span> : null}
                      <Stepper
                        name={option.name}
                        value={qty}
                        min={0}
                        max={option.maxQuantity}
                        unit={unit}
                        disabled={option.soldOut}
                        onChange={(next) => setOptionQuantity(group.id, option.id, next)}
                      />
                    </div>
                  );
                }

                const blocked = option.soldOut || (maxReached && qty === 0);
                return (
                  <div
                    key={option.id}
                    className={cn("flex flex-wrap items-center gap-x-3", qty > 0 && "bg-brand-teal-soft/60")}
                  >
                    <label
                      className={cn(
                        "flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2",
                        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-brand-teal-deep/60 has-[:focus-visible]:ring-inset",
                        blocked && "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={qty > 0}
                        disabled={blocked}
                        onChange={(e) => setOptionQuantity(group.id, option.id, e.target.checked ? 1 : 0)}
                        className={NATIVE_INPUT}
                      />
                      {label}
                      {price ? <span className="tabular text-sm text-muted-foreground">{price}</span> : null}
                    </label>
                    {qty > 0 && option.maxQuantity > 1 ? (
                      <div className="flex w-full justify-end px-4 pb-2 sm:w-auto sm:pb-0">
                        <Stepper
                          name={option.name}
                          value={qty}
                          min={1}
                          max={option.maxQuantity}
                          unit={unit}
                          onChange={(next) => setOptionQuantity(group.id, option.id, next)}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {maxReached ? (
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  That&apos;s the most for {group.name.toLowerCase()} — untick one to swap.
                </p>
              ) : null}
            </Fieldset>
          );
        })}

        <div>
          <label htmlFor={`${uid}-notes`} className="block text-lg font-bold">
            Special instructions <span className="text-sm font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id={`${uid}-notes`}
            value={instructions}
            maxLength={SPECIAL_INSTRUCTIONS_MAX}
            rows={2}
            onChange={(e) => setInstructions(e.target.value.slice(0, SPECIAL_INSTRUCTIONS_MAX))}
            placeholder="Extra hot, light foam…"
            aria-describedby={`${uid}-notes-count`}
            className="focus-ring mt-2 w-full resize-none rounded-2xl border bg-card px-4 py-3 text-base"
          />
          <p id={`${uid}-notes-count`} className="tabular mt-1 text-right text-xs text-muted-foreground">
            <span aria-hidden="true">
              {instructions.length}/{SPECIAL_INSTRUCTIONS_MAX}
            </span>
            <span className="sr-only">
              {SPECIAL_INSTRUCTIONS_MAX - instructions.length} of {SPECIAL_INSTRUCTIONS_MAX} characters left
            </span>
          </p>
        </div>
      </div>
    </>
  );

  const footer = (
    <div
      className={cn(
        "border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/85",
        layout === "page" && "sticky bottom-tabbar z-20 -mx-4 md:bottom-0 md:mx-0 md:rounded-b-2xl",
      )}
    >
      {blockedReason ? (
        <p id={`${uid}-blocked`} className="mb-2 flex gap-2 text-sm font-medium">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {blockedReason}
        </p>
      ) : attempted && errors.length > 0 ? (
        <p role="alert" className="mb-2 flex gap-2 text-sm font-semibold text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {errors.length === 1 ? errors[0].message : `Finish ${errors.length} choices above to add this.`}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Stepper
          name="Quantity"
          value={quantity}
          min={1}
          max={MAX_LINE_QUANTITY}
          unit={null}
          onChange={(next) => {
            setQuantity(next);
            setTouched(true);
          }}
        />
        <button
          type="submit"
          disabled={Boolean(blockedReason)}
          aria-describedby={blockedReason ? `${uid}-blocked` : undefined}
          className="focus-ring tabular inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand-teal-deep px-5 text-base font-bold text-white hover:bg-brand-teal-deep/90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
        >
          {product.soldOut ? "Sold out" : `Add to Cart · ${formatCents(total)}`}
        </button>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {touched ? `Price now ${formatCents(total)}` : ""}
      </p>
    </div>
  );

  return layout === "sheet" ? (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{body}</div>
      {footer}
    </form>
  ) : (
    <form onSubmit={handleSubmit} noValidate>
      {body}
      {footer}
    </form>
  );
}

// ---------------------------------------------------------------------------

const NATIVE_INPUT =
  "size-5 shrink-0 accent-brand-teal-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal-deep disabled:cursor-not-allowed";

function Fieldset({
  id,
  legend,
  hint,
  description,
  error,
  children,
}: {
  id: string;
  legend: string;
  hint: string;
  description?: string | null;
  error?: string;
  children: ReactNode;
}) {
  const describedBy = [description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");

  return (
    <fieldset id={id} aria-describedby={describedBy || undefined} aria-invalid={error ? true : undefined}>
      <legend className="flex w-full items-baseline justify-between gap-3">
        <span className="text-lg font-bold">{legend}</span>
        <span
          className={cn(
            "shrink-0 text-xs font-semibold",
            hint.startsWith("Required") ? "text-brand-magenta-deep" : "text-muted-foreground",
          )}
        >
          {hint}
        </span>
      </legend>
      {description ? (
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-destructive">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <div
        className={cn(
          "mt-2 divide-y overflow-hidden rounded-2xl border bg-card",
          error && "border-destructive ring-1 ring-destructive",
        )}
      >
        {children}
      </div>
    </fieldset>
  );
}

function OptionRow({ checked, disabled, children }: { checked: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2",
        "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-brand-teal-deep/60 has-[:focus-visible]:ring-inset",
        checked && "bg-brand-teal-soft/60",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      {children}
    </label>
  );
}

/** A labelled -/+ control; every button is 44px. */
function Stepper({
  name,
  value,
  min,
  max,
  unit,
  disabled,
  onChange,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  unit: string | null;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const shown = unit ? `${value} ${pluralUnit(unit, value)}` : String(value);
  const buttonClass =
    "focus-ring inline-flex size-11 items-center justify-center rounded-full border bg-card text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div role="group" aria-label={name} className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${name}`}
        className={buttonClass}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <output aria-live="polite" className={cn("tabular text-center text-sm font-bold", unit ? "min-w-16" : "min-w-8")}>
        {shown}
      </output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label={`Increase ${name}`}
        className={buttonClass}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

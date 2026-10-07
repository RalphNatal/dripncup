"use client";

/**
 * The catering request form. Everything is checked again on the server
 * (Zod, lead time, delivery area, which drinks are catering drinks) and the
 * database has the last word on the lead time; the checks here only answer
 * sooner. On success the form gives way to a confirmation with the request
 * number and what happens next.
 */
import { CircleAlert, CircleCheck, LoaderCircle, Minus, PartyPopper, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";

import { inputClass, textareaClass } from "@/components/admin/form-layout";
import { submitCateringRequestAction } from "@/lib/catering/actions";
import type { CateringMenuProduct } from "@/lib/catering/queries";
import { checkDeliveryArea } from "@/lib/catering/rules";
import { formatCents } from "@/lib/money";
import { cafeInstant } from "@/lib/time";
import { cn } from "@/lib/utils";

interface ItemRow {
  key: string;
  productId: string;
  sizeId: string | null;
  quantity: number;
}

export interface CateringFormProps {
  menu: CateringMenuProduct[];
  leadTimeHours: number;
  /** The earliest event time the server allows, ISO, and as "Fri, Oct 9 at 9:15 AM". */
  earliest: { iso: string; date: string; time: string; label: string };
  delivery: { offered: boolean; zipCodes: string[] };
  defaults: { name: string; email: string; phone: string };
}

let keySeq = 0;
const nextKey = () => `row-${++keySeq}`;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm font-medium text-destructive" role="alert">
      {message}
    </p>
  );
}

export function CateringRequestForm({ menu, leadTimeHours, earliest, delivery, defaults }: CateringFormProps) {
  const id = useId();
  const top = useRef<HTMLDivElement>(null);
  const [eventDate, setEventDate] = useState(earliest.date);
  const [eventTime, setEventTime] = useState(earliest.time);
  const [headcount, setHeadcount] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [adding, setAdding] = useState("");
  const [customDrink, setCustomDrink] = useState(false);
  const [customDrinkRequest, setCustomDrinkRequest] = useState("");
  const [fulfillment, setFulfillment] = useState<"pickup" | "delivery">("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryZip, setDeliveryZip] = useState("");
  const [contactName, setContactName] = useState(defaults.name);
  const [contactPhone, setContactPhone] = useState(defaults.phone);
  const [contactEmail, setContactEmail] = useState(defaults.email);
  const [budget, setBudget] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ requestId: string; requestNumber: string } | null>(null);

  const byId = useMemo(() => new Map(menu.map((p) => [p.id, p])), [menu]);
  const categories = useMemo(() => {
    const groups = new Map<string, CateringMenuProduct[]>();
    for (const product of menu) groups.set(product.categoryName ?? "More", [...(groups.get(product.categoryName ?? "More") ?? []), product]);
    return [...groups.entries()];
  }, [menu]);

  // Answers before the server does: too soon, and outside the delivery area.
  // "Too soon" is measured against the earliest time the server worked out
  // (not this device's clock, which may be wrong), so the first render here
  // matches the server's.
  const eventAt = cafeInstant(eventDate, eventTime);
  const tooSoon = eventAt ? eventAt.getTime() < Date.parse(earliest.iso) : false;
  const zipCheck =
    fulfillment === "delivery" && /^\d{5}(-\d{4})?$/.test(deliveryZip.trim())
      ? checkDeliveryArea(deliveryZip, { deliveryOffered: delivery.offered, zipCodes: delivery.zipCodes })
      : null;

  function addItem(productId: string) {
    const product = byId.get(productId);
    if (!product) return;
    setItems((rows) => [...rows, { key: nextKey(), productId, sizeId: product.sizes[0]?.id ?? null, quantity: Math.max(1, Number(headcount) || 10) }]);
    setAdding("");
  }

  function update(key: string, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (tooSoon) {
      setErrors({ eventDate: `Catering needs at least ${leadTimeHours} hours' notice. The earliest we can do is ${earliest.label}.` });
      setMessage("That's too soon for catering.");
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setPending(true);
    try {
      const result = await submitCateringRequestAction({
        eventDate,
        eventTime,
        headcount,
        items: items.map((row) => ({ productId: row.productId, sizeId: row.sizeId, quantity: row.quantity })),
        customDrink,
        customDrinkRequest,
        fulfillment,
        deliveryAddress,
        deliveryZip,
        contactName,
        contactPhone,
        contactEmail,
        budget,
        notes,
      });
      if (result.ok) {
        setDone({ requestId: result.requestId, requestNumber: result.requestNumber });
        setErrors({});
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setMessage(result.message);
      top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setMessage("Something went wrong on our end. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-3xl border-2 border-brand-teal-deep bg-card p-6 text-center" aria-live="polite" data-testid="catering-confirmation">
        <PartyPopper className="mx-auto size-10 text-brand-magenta-deep" aria-hidden="true" />
        <h2 className="mt-3 text-2xl font-extrabold">Mahalo! We got your request.</h2>
        <p className="mt-1 text-muted-foreground">
          Your request number is{" "}
          <span className="tabular font-bold text-foreground" data-testid="catering-request-number">
            {done.requestNumber}
          </span>
          .
        </p>
        <div className="mx-auto mt-5 max-w-md text-left">
          <h3 className="font-bold">What happens next</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>We put together a quote for your event, usually within a day or two, and email you when it&apos;s ready.</li>
            <li>You review it and pay online, or ask us for changes.</li>
            <li>Once it&apos;s paid you&apos;re confirmed. We&apos;ll remind you the day before.</li>
          </ol>
        </div>
        <Link
          href={`/account/catering/${done.requestId}`}
          className="focus-ring mt-6 inline-flex min-h-12 items-center rounded-full bg-brand-teal-deep px-6 font-semibold text-white hover:bg-brand-teal-deep/90"
        >
          View your request
        </Link>
      </section>
    );
  }

  const err = (key: string) => errors[key];
  const described = (key: string) => (errors[key] ? `${id}-${key}-error` : undefined);

  return (
    <form onSubmit={submit} noValidate className="space-y-6" aria-labelledby={`${id}-title`}>
      <div ref={top} className="scroll-mt-24">
        <h2 id={`${id}-title`} className="text-2xl font-extrabold">
          Request catering
        </h2>
        <p className="text-sm text-muted-foreground">All times are Honolulu time. We need at least {leadTimeHours} hours&apos; notice.</p>
        {message ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {message}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-4 rounded-3xl border bg-card p-5">
        <legend className="px-1 text-lg font-bold">Your event</legend>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <label htmlFor={`${id}-date`} className="block text-sm font-semibold">
              Date
            </label>
            <input
              id={`${id}-date`}
              name="eventDate"
              type="date"
              required
              min={earliest.date}
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
              aria-invalid={err("eventDate") || tooSoon ? true : undefined}
              aria-describedby={`${id}-lead ${described("eventDate") ?? ""}`.trim()}
              className={inputClass}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${id}-time`} className="block text-sm font-semibold">
              Start time
            </label>
            <input
              id={`${id}-time`}
              name="eventTime"
              type="time"
              step={900}
              required
              value={eventTime}
              onChange={(e) => setEventTime(e.target.value)}
              aria-invalid={err("eventTime") ? true : undefined}
              className={cn(inputClass, "sm:w-36")}
            />
          </div>
        </div>
        <p id={`${id}-lead`} className={cn("text-sm", tooSoon ? "font-semibold text-destructive" : "text-muted-foreground")}>
          {tooSoon
            ? `That's too soon: we need at least ${leadTimeHours} hours' notice. The earliest is ${earliest.label}.`
            : `The earliest we can do is ${earliest.label}.`}
        </p>
        <FieldError id={`${id}-eventDate-error`} message={err("eventDate") ?? err("eventTime")} />

        <div className="space-y-1.5 sm:max-w-48">
          <label htmlFor={`${id}-headcount`} className="block text-sm font-semibold">
            How many guests?
          </label>
          <input
            id={`${id}-headcount`}
            name="headcount"
            type="number"
            inputMode="numeric"
            min={1}
            max={5000}
            required
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
            aria-invalid={err("headcount") ? true : undefined}
            aria-describedby={described("headcount")}
            className={inputClass}
          />
          <FieldError id={`${id}-headcount-error`} message={err("headcount")} />
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-3xl border bg-card p-5">
        <legend className="px-1 text-lg font-bold">Drinks</legend>
        <p className="text-sm text-muted-foreground">Choose from our catering menu, ask for a custom signature drink, or both. Prices come with your quote.</p>
        {items.length > 0 ? (
          <ul className="space-y-3" aria-label="Drinks you've chosen">
            {items.map((row, index) => {
              const product = byId.get(row.productId);
              if (!product) return null;
              const rowError = err(`items.${index}`) ?? err(`items.${index}.quantity`);
              return (
                <li key={row.key} className="rounded-2xl border p-3" data-testid="catering-item">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{product.name}</p>
                    <button
                      type="button"
                      onClick={() => setItems((rows) => rows.filter((r) => r.key !== row.key))}
                      className="focus-ring inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-destructive"
                      aria-label={`Remove ${product.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    {product.sizes.length > 0 ? (
                      <label className="space-y-1 text-sm">
                        <span className="block font-semibold">Size</span>
                        <select
                          value={row.sizeId ?? ""}
                          onChange={(e) => update(row.key, { sizeId: e.target.value })}
                          className={inputClass}
                        >
                          {product.sizes.map((size) => (
                            <option key={size.id} value={size.id}>
                              {size.name} ({formatCents(size.priceCents)} on the menu)
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p className="self-end text-sm text-muted-foreground">{formatCents(product.basePriceCents)} on the menu</p>
                    )}
                    <div className="space-y-1 text-sm">
                      <span className="block font-semibold" id={`${row.key}-qty`}>
                        How many
                      </span>
                      <div className="flex items-center gap-1" role="group" aria-labelledby={`${row.key}-qty`}>
                        <button
                          type="button"
                          onClick={() => update(row.key, { quantity: Math.max(1, row.quantity - 1) })}
                          className="focus-ring inline-flex size-11 items-center justify-center rounded-xl border"
                          aria-label={`Fewer ${product.name}`}
                        >
                          <Minus className="size-4" aria-hidden="true" />
                        </button>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={5000}
                          value={row.quantity}
                          onChange={(e) => update(row.key, { quantity: Math.max(1, Math.min(5000, Number(e.target.value) || 1)) })}
                          className={cn(inputClass, "w-20 text-center")}
                          aria-label={`Number of ${product.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => update(row.key, { quantity: Math.min(5000, row.quantity + 1) })}
                          className="focus-ring inline-flex size-11 items-center justify-center rounded-xl border"
                          aria-label={`More ${product.name}`}
                        >
                          <Plus className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                  {rowError ? (
                    <p className="mt-2 text-sm font-medium text-destructive" role="alert">
                      {rowError}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1.5">
            <span className="block text-sm font-semibold">Add a drink</span>
            <select value={adding} onChange={(e) => setAdding(e.target.value)} className={inputClass} name="addDrink">
              <option value="">Choose a drink…</option>
              {categories.map(([category, products]) => (
                <optgroup key={category} label={category}>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => addItem(adding)}
            disabled={!adding}
            className="focus-ring inline-flex min-h-11 items-center gap-1 rounded-xl border px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden="true" />
            Add
          </button>
        </div>
        <FieldError id={`${id}-items-error`} message={err("items")} />

        <label className="flex items-start gap-3 rounded-2xl border p-3">
          <input
            type="checkbox"
            name="customDrink"
            checked={customDrink}
            onChange={(e) => setCustomDrink(e.target.checked)}
            className="mt-1 size-5 accent-[var(--brand-teal-deep)]"
          />
          <span>
            <span className="block font-semibold">A custom signature drink for my event</span>
            <span className="block text-sm text-muted-foreground">Tell us your theme, colours or favourite flavours and we&apos;ll create something just for you.</span>
          </span>
        </label>
        {customDrink ? (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-custom`} className="block text-sm font-semibold">
              Describe your signature drink
            </label>
            <textarea
              id={`${id}-custom`}
              name="customDrinkRequest"
              maxLength={1000}
              value={customDrinkRequest}
              onChange={(e) => setCustomDrinkRequest(e.target.value)}
              aria-invalid={err("customDrinkRequest") ? true : undefined}
              aria-describedby={described("customDrinkRequest")}
              className={textareaClass}
            />
            <FieldError id={`${id}-customDrinkRequest-error`} message={err("customDrinkRequest")} />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4 rounded-3xl border bg-card p-5">
        <legend className="px-1 text-lg font-bold">Pickup or delivery</legend>
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Pickup or delivery">
          {(["pickup", "delivery"] as const).map((option) =>
            option === "delivery" && !delivery.offered ? null : (
              <label
                key={option}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border p-3",
                  fulfillment === option && "border-brand-teal-deep bg-brand-teal-soft",
                )}
              >
                <input
                  type="radio"
                  name="fulfillment"
                  value={option}
                  checked={fulfillment === option}
                  onChange={() => setFulfillment(option)}
                  className="size-5 accent-[var(--brand-teal-deep)]"
                />
                <span className="font-semibold">{option === "pickup" ? "Pickup at the cafe" : "Delivery"}</span>
              </label>
            ),
          )}
        </div>
        {fulfillment === "delivery" ? (
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-address`} className="block text-sm font-semibold">
                Delivery address
              </label>
              <input
                id={`${id}-address`}
                name="deliveryAddress"
                autoComplete="street-address"
                maxLength={300}
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                aria-invalid={err("deliveryAddress") ? true : undefined}
                aria-describedby={described("deliveryAddress")}
                className={inputClass}
              />
              <FieldError id={`${id}-deliveryAddress-error`} message={err("deliveryAddress")} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-zip`} className="block text-sm font-semibold">
                ZIP code
              </label>
              <input
                id={`${id}-zip`}
                name="deliveryZip"
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={10}
                value={deliveryZip}
                onChange={(e) => setDeliveryZip(e.target.value)}
                aria-invalid={err("deliveryZip") || (zipCheck && !zipCheck.ok) ? true : undefined}
                aria-describedby={`${id}-zip-status`}
                className={inputClass}
              />
            </div>
            <div id={`${id}-zip-status`} className="sm:col-span-2" aria-live="polite">
              {err("deliveryZip") ? (
                <FieldError id={`${id}-deliveryZip-error`} message={err("deliveryZip")} />
              ) : zipCheck && !zipCheck.ok ? (
                <p className="text-sm font-medium text-destructive">{zipCheck.message}</p>
              ) : zipCheck?.ok ? (
                <p className="flex items-center gap-1.5 text-sm text-brand-teal-deep">
                  <CircleCheck className="size-4" aria-hidden="true" />
                  We deliver to {zipCheck.zip}. The delivery fee comes with your quote.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">We deliver across Oʻahu. The delivery fee comes with your quote.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Pick up from our cafe at 1221 Kapiolani Blvd.</p>
        )}
      </fieldset>

      <fieldset className="space-y-4 rounded-3xl border bg-card p-5">
        <legend className="px-1 text-lg font-bold">Your details</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["contactName", "Name", contactName, setContactName, "name", "text"],
              ["contactPhone", "Phone", contactPhone, setContactPhone, "tel", "tel"],
              ["contactEmail", "Email", contactEmail, setContactEmail, "email", "email"],
              ["budget", "Budget (optional, US dollars)", budget, setBudget, "off", "text"],
            ] as const
          ).map(([name, label, value, set, autoComplete, type]) => (
            <div key={name} className="space-y-1.5">
              <label htmlFor={`${id}-${name}`} className="block text-sm font-semibold">
                {label}
              </label>
              <input
                id={`${id}-${name}`}
                name={name}
                type={type}
                autoComplete={autoComplete}
                inputMode={name === "budget" ? "decimal" : undefined}
                value={value}
                onChange={(e) => set(e.target.value)}
                aria-invalid={err(name) ? true : undefined}
                aria-describedby={described(name)}
                className={inputClass}
              />
              <FieldError id={`${id}-${name}-error`} message={err(name)} />
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={`${id}-notes`} className="block text-sm font-semibold">
            Anything else we should know? (optional)
          </label>
          <textarea
            id={`${id}-notes`}
            name="notes"
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-invalid={err("notes") ? true : undefined}
            className={textareaClass}
          />
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="focus-ring inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-deep text-base font-semibold text-white hover:bg-brand-teal-deep/90 disabled:opacity-60"
      >
        {pending ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : null}
        {pending ? "Sending…" : "Send request"}
      </button>
      <p className="text-center text-xs text-muted-foreground">No payment now. You&apos;ll review and pay for your quote once we send it.</p>
    </form>
  );
}

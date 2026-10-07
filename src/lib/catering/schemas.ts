/**
 * Zod schemas for catering: the customer's request form, their messages, and
 * the admin's quote builder. Validated again on the server whatever the
 * browser did (and the database has the last word on lead time, totals and
 * transitions).
 */
import { z } from "zod";

import { CATERING_QUOTE_LIMITS } from "@/lib/pricing";

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} must be ${max} characters or fewer.` });

/** US numbers only (the cafe is in Honolulu): 10 digits, an optional leading 1. */
export function normalizeUsPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

const usPhone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const formatted = normalizeUsPhone(value);
    if (!formatted) {
      ctx.addIssue({ code: "custom", message: "Enter a US phone number, e.g. (808) 555-0123." });
      return z.NEVER;
    }
    return formatted;
  });

export const MAX_CATERING_ITEMS = 30;
export const MAX_HEADCOUNT = 5000;

export const cateringItemSchema = z.object({
  productId: z.guid(),
  sizeId: z.guid().nullable(),
  quantity: z.coerce
    .number({ error: "Enter how many." })
    .int({ error: "Use a whole number." })
    .min(1, { error: "At least 1." })
    .max(MAX_HEADCOUNT, { error: `At most ${MAX_HEADCOUNT}.` }),
});

export const cateringRequestSchema = z
  .object({
    /** Honolulu calendar date, YYYY-MM-DD. */
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date." }),
    /** Honolulu wall-clock time, HH:mm. */
    eventTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Pick a time." }),
    headcount: z.coerce
      .number({ error: "How many guests?" })
      .int({ error: "Use a whole number." })
      .min(1, { error: "At least 1 guest." })
      .max(MAX_HEADCOUNT, { error: `For more than ${MAX_HEADCOUNT} guests, contact us directly.` }),
    items: z.array(cateringItemSchema).max(MAX_CATERING_ITEMS, { error: `Choose up to ${MAX_CATERING_ITEMS} drinks.` }),
    customDrink: z.boolean(),
    customDrinkRequest: text(1000, "The signature drink description"),
    fulfillment: z.enum(["pickup", "delivery"]),
    deliveryAddress: text(300, "The address"),
    deliveryZip: text(10, "The ZIP code"),
    contactName: text(100, "Your name").min(2, { error: "Enter your name." }),
    contactPhone: usPhone,
    contactEmail: z.email({ error: "Enter a valid email address." }).max(254),
    /** Dollars, as typed; optional. */
    budget: z
      .string()
      .trim()
      .max(12)
      .refine((value) => value === "" || /^\$?\d{1,6}(\.\d{1,2})?$/.test(value.replace(/,/g, "")), {
        error: "Enter a dollar amount, e.g. 450.",
      }),
    notes: text(2000, "Notes"),
  })
  .superRefine((value, ctx) => {
    if (value.items.length === 0 && !value.customDrink) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "Choose at least one drink, or ask for a custom signature drink." });
    }
    if (value.customDrink && value.customDrinkRequest.length < 10) {
      ctx.addIssue({ code: "custom", path: ["customDrinkRequest"], message: "Tell us a little about the drink you have in mind." });
    }
    if (value.fulfillment === "delivery") {
      if (value.deliveryAddress.length < 5) ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Enter the delivery address." });
      if (!/^\d{5}(-\d{4})?$/.test(value.deliveryZip)) ctx.addIssue({ code: "custom", path: ["deliveryZip"], message: "Enter a 5-digit ZIP code." });
    }
    const seen = new Set<string>();
    value.items.forEach((item, index) => {
      const key = `${item.productId}:${item.sizeId ?? ""}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["items", index], message: "That drink and size is already on the list." });
      seen.add(key);
    });
  });

export type CateringRequestInput = z.input<typeof cateringRequestSchema>;

/** Budget as typed ("$1,200") -> cents, or null. */
export function budgetCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return null;
  return Math.round(Number(cleaned) * 100);
}

export const cateringMessageSchema = z.object({
  requestId: z.guid(),
  message: text(2000, "Your message").min(3, { error: "Write a few words." }),
});

export const cateringCancelSchema = z.object({
  requestId: z.guid(),
  reason: text(500, "The reason"),
});

// ---------------------------------------------------------------------------
// The admin's quote builder.
// ---------------------------------------------------------------------------

const cents = (label: string, max: number) =>
  z
    .number({ error: `Enter ${label}.` })
    .int({ error: `${label} must be in whole cents.` })
    .min(0, { error: `${label} can't be negative.` })
    .max(max, { error: `${label} is too large.` });

export const quoteLineSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("product"),
    productId: z.guid(),
    sizeId: z.guid().nullable(),
    description: text(200, "The description").min(1, { error: "Describe the line." }),
    quantity: z.number().int().min(1).max(CATERING_QUOTE_LIMITS.maxQuantity),
    unitPriceCents: cents("a unit price", CATERING_QUOTE_LIMITS.maxUnitPriceCents),
  }),
  z.object({
    kind: z.literal("custom"),
    description: text(200, "The description").min(1, { error: "Describe the line." }),
    quantity: z.number().int().min(1).max(CATERING_QUOTE_LIMITS.maxQuantity),
    unitPriceCents: cents("a unit price", CATERING_QUOTE_LIMITS.maxUnitPriceCents),
  }),
]);

export const quoteSchema = z.object({
  requestId: z.guid(),
  lines: z.array(quoteLineSchema).min(1, { error: "Add at least one line." }).max(CATERING_QUOTE_LIMITS.maxLines),
  deliveryFeeCents: cents("a delivery fee", CATERING_QUOTE_LIMITS.maxDeliveryFeeCents),
  discount: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("amount"), amountCents: cents("a discount", 100_000_000), label: text(80, "The discount label") }),
      z.object({ kind: z.literal("percent"), percent: z.number().min(0).max(100), label: text(80, "The discount label") }),
    ])
    .nullable(),
  gratuity: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("percent"), percent: z.number().min(0).max(CATERING_QUOTE_LIMITS.maxGratuityPercent) }),
      z.object({ kind: z.literal("amount"), amountCents: cents("a gratuity", 10_000_000) }),
    ])
    .nullable(),
  /** ISO instant. */
  expiresAt: z.iso.datetime({ offset: true }),
  noteToCustomer: text(2000, "The note"),
});

export type QuoteInput = z.input<typeof quoteSchema>;

export const adminCancelSchema = z.object({
  requestId: z.guid(),
  reason: text(500, "The reason").min(3, { error: "Give a reason (3 characters or more)." }),
  /** For a paid request: "full", "none", or a partial amount in cents. */
  refund: z.union([z.literal("full"), z.literal("none"), z.number().int().min(1)]).optional(),
});

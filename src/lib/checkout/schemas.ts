/**
 * Input schemas for the cart and checkout Server Actions. Everything the
 * browser sends is untrusted: ids are checked against the catalogue, prices
 * are recomputed, and these schemas bound the shape and size first.
 */
import { z } from "zod";

import { MAX_LINE_QUANTITY, SPECIAL_INSTRUCTIONS_MAX } from "@/lib/pricing";

const id = () => z.guid();

export const cartLineSchema = z.object({
  id: z.string().min(1).max(64),
  locationId: id(),
  productId: id(),
  sizeId: id().nullable(),
  /** group id -> option id -> quantity */
  selection: z.record(id(), z.record(id(), z.number().int().min(0).max(MAX_LINE_QUANTITY))),
  specialInstructions: z.string().max(SPECIAL_INSTRUCTIONS_MAX),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  /** What the customer was shown; only used to report a price change. */
  unitPriceCents: z.number().int().min(0).max(10_000_000),
});

export const cartLinesSchema = z.array(cartLineSchema).max(50);

export const tipChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("percent"), percent: z.number().min(0).max(100) }),
  z.object({ kind: z.literal("custom"), cents: z.number().int().min(0).max(1_000_000) }),
]);

export const pickupChoiceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("asap") }),
  z.object({ type: z.literal("scheduled"), slot: z.string().min(1).max(40) }),
]);

const promoCode = z
  .string()
  .trim()
  .max(40)
  .transform((v) => (v === "" ? null : v.toUpperCase()))
  .nullable()
  .optional();

export const quoteInputSchema = z.object({
  lines: cartLinesSchema,
  promoCode,
  tip: tipChoiceSchema,
  pickup: pickupChoiceSchema.nullable(),
});

export const checkoutInputSchema = quoteInputSchema.extend({
  pickup: pickupChoiceSchema,
  /** One per checkout attempt, generated in the browser. */
  idempotencyKey: z.string().min(16).max(80).regex(/^[A-Za-z0-9_-]+$/),
  cupName: z.string().trim().min(1, { error: "Tell us the name for your cup." }).max(30),
  notes: z.string().trim().max(200).optional().default(""),
});

export type CartLineInput = z.infer<typeof cartLineSchema>;
export type QuoteInput = z.input<typeof quoteInputSchema>;
export type CheckoutInput = z.input<typeof checkoutInputSchema>;

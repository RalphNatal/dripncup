/** The admin collection form. Dates and times are Honolulu's. */
import { z } from "zod";

import { SLUG_PATTERN } from "@/lib/events/schemas";
import { cafeInstant } from "@/lib/time";

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} must be ${max} characters or fewer.` });

export const MAX_COLLECTION_PRODUCTS = 40;

export const collectionFormSchema = z
  .object({
    id: z.guid().nullable(),
    name: text(80, "The name").min(2, { error: "Give the collection a name." }),
    slug: text(80, "The web address").refine((v) => v === "" || SLUG_PATTERN.test(v), {
      error: "Use lowercase letters, numbers and single hyphens.",
    }),
    description: text(500, "The description"),
    bannerPath: z.string().max(200).nullable(),
    /** #RRGGBB or empty (the brand accent). */
    accentColor: z
      .string()
      .trim()
      .refine((v) => v === "" || /^#[0-9a-fA-F]{6}$/.test(v), { error: "Use a colour like #E0409B." }),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a start date." }),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Pick a start time." }),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick an end date." }),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Pick an end time." }),
    isActive: z.boolean(),
    products: z
      .array(z.object({ productId: z.guid(), limited: z.boolean() }))
      .max(MAX_COLLECTION_PRODUCTS, { error: `At most ${MAX_COLLECTION_PRODUCTS} products.` }),
  })
  .superRefine((value, ctx) => {
    const starts = cafeInstant(value.startDate, value.startTime);
    const ends = cafeInstant(value.endDate, value.endTime);
    if (!starts) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Pick a real date." });
    if (!ends) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Pick a real date." });
    if (starts && ends && ends.getTime() <= starts.getTime()) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "The collection must end after it starts." });
    }
    const ids = value.products.map((p) => p.productId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["products"], message: "A product is listed twice." });
  });

export type CollectionFormInput = z.input<typeof collectionFormSchema>;

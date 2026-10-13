/**
 * Favourite ("My usual") rules shared by the forms and the Server Actions.
 * The database enforces the same limits (favorites_name_check, the per-customer
 * cap in enforce_favorites_limit), so these are the friendly first line.
 */
import { z } from "zod";

import { SPECIAL_INSTRUCTIONS_MAX } from "@/lib/pricing";

import { FAVORITE_NAME_MAX, FAVORITE_NAME_REQUIRED, FAVORITE_NAME_TOO_LONG, FAVORITES_LIMIT } from "./names";

export { FAVORITE_NAME_MAX, FAVORITES_LIMIT, defaultFavoriteName } from "./names";

export const favoriteNameSchema = z
  .string({ error: FAVORITE_NAME_REQUIRED })
  .trim()
  .min(1, { error: FAVORITE_NAME_REQUIRED })
  .max(FAVORITE_NAME_MAX, { error: FAVORITE_NAME_TOO_LONG });

const id = () => z.guid();

export const saveFavoriteSchema = z.object({
  name: favoriteNameSchema,
  productId: id(),
  sizeId: id().nullable(),
  /** group id -> option id -> quantity, as the product sheet holds it. */
  selection: z.record(id(), z.record(id(), z.number().int().min(0).max(99))),
  specialInstructions: z.string().trim().max(SPECIAL_INSTRUCTIONS_MAX).optional().default(""),
});

export type SaveFavoriteInput = z.input<typeof saveFavoriteSchema>;

export const LIMIT_MESSAGE = `You've saved ${FAVORITES_LIMIT} favorites, the most we can keep. Remove one to save another.`;
export const DUPLICATE_MESSAGE = "You already have a favorite with that name. Try another.";

/** A database error from saving or renaming, as a sentence for the customer. */
export function favoriteErrorMessage(code: string | undefined): string {
  if (code === "DC003") return LIMIT_MESSAGE;
  if (code === "23505") return DUPLICATE_MESSAGE;
  if (code === "23514") return `Keep the name between 1 and ${FAVORITE_NAME_MAX} characters.`;
  return "We couldn't save that. Please try again.";
}

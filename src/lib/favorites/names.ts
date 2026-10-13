/**
 * Favourite names, without Zod: the save and rename forms are in the
 * browser, and Zod would add ~90 KB of JavaScript to every page that can
 * save a favourite. schemas.ts builds the server's Zod schema from these.
 */
export const FAVORITE_NAME_MAX = 40;
export const FAVORITES_LIMIT = 50;

export const FAVORITE_NAME_REQUIRED = "Give your favorite a name.";
export const FAVORITE_NAME_TOO_LONG = `Keep the name to ${FAVORITE_NAME_MAX} characters or fewer.`;

/** The trimmed name, or why it can't be used (the same rules as favoriteNameSchema). */
export function checkFavoriteName(raw: unknown): { ok: true; name: string } | { ok: false; message: string } {
  if (typeof raw !== "string") return { ok: false, message: FAVORITE_NAME_REQUIRED };
  const name = raw.trim();
  if (name.length === 0) return { ok: false, message: FAVORITE_NAME_REQUIRED };
  if (name.length > FAVORITE_NAME_MAX) return { ok: false, message: FAVORITE_NAME_TOO_LONG };
  return { ok: true, name };
}

/** A favourite's name, prefilled from the product and cut to fit. */
export function defaultFavoriteName(productName: string): string {
  return productName.trim().slice(0, FAVORITE_NAME_MAX).trim();
}

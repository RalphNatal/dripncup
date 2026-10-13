/**
 * Auth limits the browser forms show, without Zod (schemas.ts, the server's
 * Zod schemas, uses the same values).
 */
export const PASSWORD_MIN_LENGTH = 8;
/** Supabase hashes with bcrypt, which ignores everything past 72 bytes. */
export const PASSWORD_MAX_LENGTH = 72;
/** What the customer types to confirm deleting their account. */
export const DELETE_CONFIRMATION = "DELETE";

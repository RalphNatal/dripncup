/**
 * Fails fast, with a useful message, when the database the suite needs is
 * missing -- rather than as thirty confusing timeouts.
 */
import { SEEDED, db } from "./support/db";

export default async function globalSetup() {
  const { data, error } = await db().from("locations").select("id").eq("slug", SEEDED.cafeSlug).maybeSingle();

  if (error) {
    throw new Error(`Cannot reach the local database (${error.message}). Run \`npm run db:start\` first.`);
  }
  if (!data) {
    throw new Error("The database is not seeded. Run `npm run db:reset` then `npm run db:seed`.");
  }
}

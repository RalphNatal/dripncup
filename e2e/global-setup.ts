/**
 * Fails fast, with a useful message, when the e2e stack the suite needs is
 * missing -- rather than as thirty confusing timeouts. Then pins the
 * storefront to a known state (cafe open around the clock, nothing paused,
 * closed or sold out) and returns a teardown that puts the original back.
 */
import { SEEDED, db } from "./support/db";
import { makeCafeAlwaysOpen, restoreStorefront, snapshotStorefront } from "./support/storefront";

export default async function globalSetup() {
  const { data, error } = await db().from("locations").select("id").eq("slug", SEEDED.cafeSlug).maybeSingle();

  if (error) {
    throw new Error(`Cannot reach the e2e database (${error.message}). Run the suite with \`npm run test:e2e\`, which starts it.`);
  }
  if (!data) {
    throw new Error("The e2e database is not seeded. Run the suite with `npm run test:e2e`, which resets and seeds it.");
  }

  const snapshot = await snapshotStorefront();
  await makeCafeAlwaysOpen();

  return async () => {
    await restoreStorefront(snapshot);
  };
}

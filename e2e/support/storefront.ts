/**
 * Arranging storefront state for e2e tests: opening hours, the pause toggle,
 * closures and sold-out flags. Everything the suite changes is snapshotted in
 * global setup and put back in global teardown.
 */
import type { Tables } from "../../src/types/database";

import { SEEDED, db, locationIdBySlug, must } from "./db";

export interface StorefrontSnapshot {
  hours: Tables<"location_hours">[];
  closures: Tables<"closures">[];
  availability: Tables<"location_availability">[];
  accepting: { id: string; accepting_orders: boolean; paused_until: string | null }[];
}

export async function snapshotStorefront(): Promise<StorefrontSnapshot> {
  const [hours, closures, availability, accepting] = await Promise.all([
    db().from("location_hours").select("*"),
    db().from("closures").select("*"),
    db().from("location_availability").select("*"),
    db().from("locations").select("id, accepting_orders, paused_until"),
  ]);
  return {
    hours: must(hours, "snapshot hours"),
    closures: must(closures, "snapshot closures"),
    availability: must(availability, "snapshot availability"),
    accepting: must(accepting, "snapshot accepting_orders"),
  };
}

export async function restoreStorefront(snapshot: StorefrontSnapshot) {
  await db().from("location_hours").delete().not("id", "is", null);
  await db().from("closures").delete().not("id", "is", null);
  await db().from("location_availability").delete().not("id", "is", null);
  if (snapshot.hours.length) await db().from("location_hours").insert(snapshot.hours);
  if (snapshot.closures.length) await db().from("closures").insert(snapshot.closures);
  if (snapshot.availability.length) await db().from("location_availability").insert(snapshot.availability);
  for (const row of snapshot.accepting) {
    await db().from("locations").update({ accepting_orders: row.accepting_orders, paused_until: row.paused_until }).eq("id", row.id);
  }
}

/**
 * The cafe open around the clock with nothing sold out, so a test's outcome
 * never depends on what time it happens to be in Honolulu. Midnight to
 * 24:00 every day, so even ASAP just before midnight works.
 */
export async function makeCafeAlwaysOpen() {
  const cafeId = await locationIdBySlug(SEEDED.cafeSlug);
  await db().from("location_hours").delete().eq("location_id", cafeId);
  must(
    await db()
      .from("location_hours")
      .insert(
        Array.from({ length: 7 }, (_, day) => ({
          location_id: cafeId,
          day_of_week: day,
          opens_at: "00:00:00",
          closes_at: "24:00:00",
        })),
      )
      .select(),
    "open all hours",
  );
  await db().from("closures").delete().not("id", "is", null);
  await db().from("location_availability").delete().not("id", "is", null);
  await db().from("locations").update({ accepting_orders: true, paused_until: null }).not("id", "is", null);
}

/** Today's date in Honolulu, as closures store it. */
export function honoluluToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu" }).format(new Date());
}

export async function setPaused(slug: string, paused: boolean) {
  must(
    await db().from("locations").update({ accepting_orders: !paused }).eq("slug", slug).select().single(),
    "set pause",
  );
}

export async function closeToday(slug: string) {
  const locationId = await locationIdBySlug(slug);
  must(
    await db()
      .from("closures")
      .insert({ location_id: locationId, closure_date: honoluluToday(), is_closed: true, reason: "E2E closure" })
      .select()
      .single(),
    "close today",
  );
  return async () => {
    await db().from("closures").delete().eq("location_id", locationId).eq("closure_date", honoluluToday());
  };
}

/** Marks a product and/or an option sold out at a location; returns an undo. */
export async function markSoldOut(
  slug: string,
  target: { productSlug?: string; option?: { groupSlug: string; name: string } },
) {
  const locationId = await locationIdBySlug(slug);
  const rows: { location_id: string; product_id?: string; modifier_option_id?: string; is_available: boolean }[] = [];

  if (target.productSlug) {
    const product = must(
      await db().from("products").select("id").eq("slug", target.productSlug).single(),
      "find product",
    );
    rows.push({ location_id: locationId, product_id: product.id, is_available: false });
  }
  if (target.option) {
    const group = must(
      await db().from("modifier_groups").select("id").eq("slug", target.option.groupSlug).single(),
      "find group",
    );
    const option = must(
      await db()
        .from("modifier_options")
        .select("id")
        .eq("modifier_group_id", group.id)
        .eq("name", target.option.name)
        .single(),
      "find option",
    );
    rows.push({ location_id: locationId, modifier_option_id: option.id, is_available: false });
  }

  const inserted = must(await db().from("location_availability").insert(rows).select("id"), "mark sold out");
  return async () => {
    await db()
      .from("location_availability")
      .delete()
      .in(
        "id",
        inserted.map((r) => r.id),
      );
  };
}

/** Names of the products on a pop-up's own menu, straight from the database. */
export async function eventMenuProductNames(slug: string): Promise<string[]> {
  const locationId = await locationIdBySlug(slug);
  const rows = must(
    await db().from("event_menu_items").select("product:products(name)").eq("location_id", locationId),
    "event menu",
  );
  return rows.flatMap((r) => (r.product ? [r.product.name] : [])).sort();
}

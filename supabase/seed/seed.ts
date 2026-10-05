/**
 * Seed script -- `npm run db:seed`.
 *
 * Populates a local database with a realistic Honolulu cafe menu, one pop-up
 * event, rewards, promos, catering enquiries and a test account per role.
 *
 * Runs with the service role, so it bypasses RLS. It refuses to run against a
 * non-local Supabase URL unless `--force` is passed, because it clears the
 * tables it owns before inserting.
 *
 * NEEDS_CONFIRMATION: the menu, prices, hours and pickup copy below are
 * plausible stand-ins. Replace them with the cafe's real offerings.
 */
import {
  createClient,
  type PostgrestSingleResponse,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { config } from "dotenv";

import type { Database } from "../../src/types/database";

config({ path: ".env.local" });
config({ path: ".env" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FORCE = process.argv.includes("--force");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill in the values printed by `npm run db:start`.",
  );
  process.exit(1);
}

const isLocal = /(^https?:\/\/)?(127\.0\.0\.1|localhost)/.test(SUPABASE_URL);
if (!isLocal && !FORCE) {
  console.error(
    `Refusing to seed a non-local database (${SUPABASE_URL}).\n` +
      "This script deletes existing rows. Re-run with --force only if you are certain.",
  );
  process.exit(1);
}

const db: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Unwraps a PostgREST response, throwing with context instead of returning a
 * quiet null.
 *
 * Typed with Supabase's own `PostgrestSingleResponse` rather than a structural
 * stand-in: matching a hand-written `{ data: T | null }` against postgrest's
 * discriminated union makes `T` inference ambiguous, and it collapses to
 * `never`, which silently poisons every downstream property access.
 *
 * `PostgrestResponse<Row>` is an alias for `PostgrestSingleResponse<Row[]>`, so
 * this one helper covers both `.single()` and plain `.select()` calls.
 */
function ok<T>(result: PostgrestSingleResponse<T>, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const dollars = (value: number) => Math.round(value * 100);

// ---------------------------------------------------------------------------
// Test accounts
// ---------------------------------------------------------------------------

const TEST_PASSWORD = "DrincupTest123!";

const TEST_ACCOUNTS = [
  { email: "admin@drincup.test", fullName: "Alika Admin", role: "admin" as const },
  { email: "barista@drincup.test", fullName: "Kekoa Barista", role: "staff" as const },
  { email: "customer@drincup.test", fullName: "Leilani Customer", role: "customer" as const },
];

// ---------------------------------------------------------------------------
// Wipe, in foreign-key-safe order
// ---------------------------------------------------------------------------

const WIPE_ORDER = [
  "order_rewards",
  "loyalty_reservations",
  "loyalty_transactions",
  "promo_redemptions",
  "order_status_history",
  "order_items",
  "payments",
  "orders",
  "catering_request_items",
  "catering_requests",
  "favorites",
  "collection_products",
  "collections",
  "event_menu_items",
  "location_availability",
  // After location_availability: clearing it writes log rows.
  "location_availability_log",
  "product_modifier_groups",
  "modifier_options",
  "modifier_groups",
  "product_sizes",
  "products",
  "categories",
  "closures",
  "location_hours",
  "staff_locations",
  "locations",
  "promos",
  "rewards",
] as const;

async function wipe() {
  for (const table of WIPE_ORDER) {
    // supabase-js requires a filter on delete; this matches every row.
    const { error } = await db.from(table).delete().not("created_at", "is", null);
    if (error) throw new Error(`wipe ${table}: ${error.message}`);
  }

  // Reset the human-readable daily numbering so seeded orders start at 0001.
  await db.from("daily_counters").delete().not("counter_day", "is", null);

  // Remove test auth users so re-seeding does not collide on email.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
  const testEmails = new Set(TEST_ACCOUNTS.map((a) => a.email));
  for (const user of users?.users ?? []) {
    if (user.email && testEmails.has(user.email)) {
      await db.auth.admin.deleteUser(user.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

async function seedLocations() {
  const cafe = ok(
    await db
      .from("locations")
      .insert({
        type: "cafe",
        name: "Drincup Cafe — Kapiolani",
        slug: "kapiolani",
        description: "Our home on Kapiolani Blvd. Good drinks, food, & community.",
        address_line1: "1221 Kapiolani Blvd",
        address_line2: "Site 112A",
        city: "Honolulu",
        state: "HI",
        postal_code: "96814",
        latitude: 21.29307,
        longitude: -157.84116,
        pickup_instructions:
          "Come in through the Kapiolani entrance — the pickup shelf is at the end of the counter, and your name will be on the cup.",
        prep_time_minutes: 8,
        sort_order: 0,
      })
      .select()
      .single(),
    "insert cafe",
  );

  // NEEDS_CONFIRMATION: real trading hours. Placeholder: open every day,
  // 7:00 AM - 6:00 PM Honolulu time. 0 = Sunday .. 6 = Saturday.
  // No closures or holiday hours are seeded; admins add those as needed.
  const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day_of_week: day, opens_at: "07:00", closes_at: "18:00" }));

  ok(
    await db
      .from("location_hours")
      .insert(hours.map((h) => ({ ...h, location_id: cafe.id })))
      .select(),
    "insert hours",
  );

  // A pop-up two weeks out, 10:00-15:00 HST.
  // setUTCHours, not setHours: the seed must produce the same instants
  // whichever timezone the developer's machine is in. HST is UTC-10, so
  // 20:00 UTC is 10:00 in Honolulu.
  const eventStart = new Date();
  eventStart.setUTCDate(eventStart.getUTCDate() + 14);
  eventStart.setUTCHours(20, 0, 0, 0);
  const eventEnd = new Date(eventStart.getTime() + 5 * 60 * 60 * 1000);

  const event = ok(
    await db
      .from("locations")
      .insert({
        type: "event",
        name: "Kakaʻako Farmers Market Pop-Up",
        slug: "kakaako-market-popup",
        description:
          "Find our booth at the Kakaʻako market — a short menu of refreshers, cold brew and shave ice.",
        address_line1: "919 Ala Moana Blvd",
        city: "Honolulu",
        state: "HI",
        postal_code: "96814",
        pickup_instructions: "Look for the teal canopy near the Ala Moana Blvd entrance.",
        prep_time_minutes: 12,
        starts_at: eventStart.toISOString(),
        ends_at: eventEnd.toISOString(),
        sort_order: 1,
      })
      .select()
      .single(),
    "insert event",
  );

  return { cafe, event };
}

// ---------------------------------------------------------------------------
// Modifier groups
// ---------------------------------------------------------------------------

type GroupSeed = {
  slug: string;
  name: string;
  description?: string;
  selection_type: "single" | "multi";
  is_required?: boolean;
  min_selections?: number;
  max_selections?: number | null;
  max_quantity_per_option?: number;
  /** "pump", "shot" -- how one unit reads in the UI. */
  quantity_unit?: string;
  /** false = the price delta is charged once however many units. */
  charge_per_quantity?: boolean;
  sort_order: number;
  options: {
    name: string;
    price_delta_cents?: number;
    is_default?: boolean;
    max_quantity?: number;
    allergens?: Database["public"]["Enums"]["allergen"][];
  }[];
};

const MODIFIER_GROUPS: GroupSeed[] = [
  {
    slug: "temperature",
    name: "Hot or Iced",
    selection_type: "single",
    is_required: true,
    min_selections: 1,
    max_selections: 1,
    sort_order: 10,
    options: [
      { name: "Hot", is_default: true },
      { name: "Iced" },
    ],
  },
  {
    slug: "milk",
    name: "Milk",
    description: "Pick your base.",
    selection_type: "single",
    is_required: true,
    min_selections: 1,
    max_selections: 1,
    sort_order: 20,
    options: [
      { name: "Whole milk", is_default: true, allergens: ["dairy"] },
      { name: "Nonfat milk", allergens: ["dairy"] },
      { name: "Oat milk", price_delta_cents: 80, allergens: ["gluten"] },
      { name: "Almond milk", price_delta_cents: 80, allergens: ["tree_nuts"] },
      { name: "Macadamia milk", price_delta_cents: 90, allergens: ["tree_nuts", "macadamia"] },
      { name: "Coconut milk", price_delta_cents: 80 },
      { name: "Soy milk", price_delta_cents: 70, allergens: ["soy"] },
    ],
  },
  {
    // Black coffee by default; milk is an optional add.
    slug: "add-milk",
    name: "Add milk",
    description: "Served black unless you add some.",
    selection_type: "single",
    max_selections: 1,
    sort_order: 25,
    options: [
      { name: "Whole milk", allergens: ["dairy"] },
      { name: "Nonfat milk", allergens: ["dairy"] },
      { name: "Oat milk", price_delta_cents: 80, allergens: ["gluten"] },
      { name: "Almond milk", price_delta_cents: 80, allergens: ["tree_nuts"] },
      { name: "Macadamia milk", price_delta_cents: 90, allergens: ["tree_nuts", "macadamia"] },
      { name: "Coconut milk", price_delta_cents: 80 },
    ],
  },
  {
    slug: "espresso-shots",
    name: "Espresso shots",
    description: "Add extra shots.",
    selection_type: "multi",
    max_selections: 1,
    max_quantity_per_option: 4,
    quantity_unit: "shot",
    charge_per_quantity: true,
    sort_order: 30,
    options: [{ name: "Extra espresso shot", price_delta_cents: 100, max_quantity: 4 }],
  },
  {
    slug: "syrups",
    name: "Flavors & syrups",
    description: "Up to three flavors, up to six pumps each. Each flavor is one price, however many pumps.",
    selection_type: "multi",
    max_selections: 3,
    max_quantity_per_option: 6,
    quantity_unit: "pump",
    charge_per_quantity: false,
    sort_order: 40,
    options: [
      { name: "Vanilla", price_delta_cents: 75, max_quantity: 6 },
      { name: "Macadamia", price_delta_cents: 85, max_quantity: 6, allergens: ["tree_nuts", "macadamia"] },
      { name: "Toasted coconut", price_delta_cents: 75, max_quantity: 6 },
      { name: "Lilikoʻi", price_delta_cents: 75, max_quantity: 6 },
      { name: "Mango", price_delta_cents: 75, max_quantity: 6 },
      { name: "Brown sugar", price_delta_cents: 75, max_quantity: 6 },
      { name: "Caramel", price_delta_cents: 75, max_quantity: 6, allergens: ["dairy"] },
    ],
  },
  {
    slug: "sweetness",
    name: "Sweetness",
    selection_type: "single",
    is_required: true,
    min_selections: 1,
    max_selections: 1,
    sort_order: 50,
    options: [
      { name: "No sugar" },
      { name: "25%" },
      { name: "50%" },
      { name: "75%" },
      { name: "100%", is_default: true },
    ],
  },
  {
    slug: "ice-level",
    name: "Ice",
    selection_type: "single",
    is_required: true,
    min_selections: 1,
    max_selections: 1,
    sort_order: 60,
    options: [
      { name: "No ice" },
      { name: "Light ice" },
      { name: "Regular ice", is_default: true },
      { name: "Extra ice" },
    ],
  },
  {
    slug: "toppings",
    name: "Toppings",
    selection_type: "multi",
    max_selections: 4,
    sort_order: 70,
    options: [
      { name: "Whipped cream", price_delta_cents: 75, allergens: ["dairy"] },
      { name: "Boba pearls", price_delta_cents: 100 },
      { name: "Li hing powder", price_delta_cents: 50 },
      { name: "Toasted coconut flakes", price_delta_cents: 75 },
      { name: "Macadamia crumble", price_delta_cents: 100, allergens: ["tree_nuts", "macadamia"] },
    ],
  },
  {
    slug: "signature-addons",
    name: "Make it special",
    description: "Our house add-ons.",
    selection_type: "multi",
    max_selections: 2,
    sort_order: 80,
    options: [
      { name: "Overflow Sparkle (edible shimmer)", price_delta_cents: 125 },
      { name: "Cold foam top", price_delta_cents: 110, allergens: ["dairy"] },
    ],
  },
  {
    slug: "shave-ice-flavors",
    name: "Shave ice flavors",
    description: "Choose up to three.",
    selection_type: "multi",
    is_required: true,
    min_selections: 1,
    max_selections: 3,
    sort_order: 20,
    options: [
      { name: "Lilikoʻi" },
      { name: "Guava" },
      { name: "Mango" },
      { name: "Blue vanilla" },
      { name: "Strawberry" },
      { name: "Coconut" },
    ],
  },
  {
    slug: "shave-ice-addons",
    name: "Shave ice add-ons",
    selection_type: "multi",
    max_selections: 4,
    sort_order: 30,
    options: [
      { name: "Vanilla ice cream base", price_delta_cents: 150, allergens: ["dairy"] },
      { name: "Azuki beans", price_delta_cents: 125 },
      { name: "Snow cap (condensed milk)", price_delta_cents: 100, allergens: ["dairy"] },
      { name: "Mochi bites", price_delta_cents: 125 },
    ],
  },
];

/**
 * Conditional groups: `group` is only shown while `whenOption` (in
 * `whenGroup`) is selected. Applied to every product that links both groups;
 * a cold-only drink without the temperature group shows Ice unconditionally.
 */
const CONDITIONAL_GROUPS = [{ group: "ice-level", whenGroup: "temperature", whenOption: "Iced" }] as const;

async function seedModifiers() {
  const groupIds = new Map<string, string>();
  /** "group-slug/Option name" -> option id */
  const optionIds = new Map<string, string>();

  for (const group of MODIFIER_GROUPS) {
    const row = ok(
      await db
        .from("modifier_groups")
        .insert({
          name: group.name,
          slug: group.slug,
          description: group.description ?? null,
          selection_type: group.selection_type,
          is_required: group.is_required ?? false,
          min_selections: group.min_selections ?? 0,
          max_selections: group.max_selections ?? null,
          max_quantity_per_option: group.max_quantity_per_option ?? 1,
          quantity_unit: group.quantity_unit ?? null,
          charge_per_quantity: group.charge_per_quantity ?? true,
          sort_order: group.sort_order,
        })
        .select()
        .single(),
      `insert modifier group ${group.slug}`,
    );

    groupIds.set(group.slug, row.id);

    const options = ok(
      await db
        .from("modifier_options")
        .insert(
          group.options.map((option, index) => ({
            modifier_group_id: row.id,
            name: option.name,
            price_delta_cents: option.price_delta_cents ?? 0,
            is_default: option.is_default ?? false,
            max_quantity: option.max_quantity ?? 1,
            allergens: option.allergens ?? [],
            sort_order: index * 10,
          })),
        )
        .select(),
      `insert options for ${group.slug}`,
    );

    for (const option of options) optionIds.set(`${group.slug}/${option.name}`, option.id);
  }

  return { groupIds, optionIds };
}

// ---------------------------------------------------------------------------
// Categories and products
// ---------------------------------------------------------------------------

type ProductSeed = {
  slug: string;
  name: string;
  description: string;
  /** [size name, price in dollars, oz] -- omit for single-price items. */
  sizes?: [string, number, number][];
  basePrice?: number;
  allergens?: Database["public"]["Enums"]["allergen"][];
  dietary?: Database["public"]["Enums"]["dietary_tag"][];
  modifierGroups: string[];
  catering?: boolean;
};

const DRINK_SIZES: [string, number, number][] = [
  ["Small", 4.75, 12],
  ["Medium", 5.75, 16],
  ["Large", 6.5, 24],
];

// Ice sits straight after Hot/Iced: it appears only once Iced is picked
// (CONDITIONAL_GROUPS), right where the customer is looking.
const HOT_DRINK_GROUPS = ["temperature", "ice-level", "milk", "espresso-shots", "syrups", "signature-addons"];
const COLD_DRINK_GROUPS = ["sweetness", "ice-level", "syrups", "toppings", "signature-addons"];

const CATALOG: { slug: string; name: string; description: string; products: ProductSeed[] }[] = [
  {
    slug: "coffee-espresso",
    name: "Coffee & Espresso",
    description: "Island-roasted beans, pulled to order.",
    products: [
      {
        slug: "kona-drip-coffee",
        name: "Kona Blend Drip",
        description: "Our house drip, smooth and nutty with a clean finish.",
        sizes: [["Small", 3.5, 12], ["Medium", 4.25, 16], ["Large", 4.95, 24]],
        dietary: ["contains_caffeine", "vegan"],
        modifierGroups: ["temperature", "ice-level", "add-milk", "syrups", "sweetness"],
        catering: true,
      },
      {
        slug: "cold-brew",
        name: "Cold Brew",
        description: "Steeped 18 hours for a low-acid, chocolatey cup.",
        sizes: [["Medium", 5.25, 16], ["Large", 6.0, 24]],
        dietary: ["contains_caffeine", "vegan"],
        modifierGroups: ["ice-level", "add-milk", "syrups", "sweetness", "signature-addons"],
        catering: true,
      },
      {
        slug: "latte",
        name: "Latte",
        description: "Double shot, steamed milk, a little foam.",
        sizes: DRINK_SIZES,
        allergens: ["dairy"],
        dietary: ["contains_caffeine", "vegetarian"],
        modifierGroups: HOT_DRINK_GROUPS,
        catering: true,
      },
      {
        slug: "vanilla-macadamia-latte",
        name: "Vanilla Macadamia Latte",
        description: "Our signature: vanilla, toasted macadamia, espresso.",
        sizes: [["Small", 5.5, 12], ["Medium", 6.5, 16], ["Large", 7.25, 24]],
        allergens: ["dairy", "tree_nuts", "macadamia"],
        dietary: ["contains_caffeine", "vegetarian"],
        modifierGroups: HOT_DRINK_GROUPS,
        catering: true,
      },
      {
        slug: "cappuccino",
        name: "Cappuccino",
        description: "Equal parts espresso, milk and foam.",
        sizes: [["Small", 4.5, 8], ["Medium", 5.25, 12]],
        allergens: ["dairy"],
        dietary: ["contains_caffeine", "vegetarian"],
        modifierGroups: ["milk", "espresso-shots", "syrups"],
      },
      {
        slug: "americano",
        name: "Americano",
        description: "Espresso and hot water, bright and simple.",
        sizes: DRINK_SIZES,
        dietary: ["contains_caffeine", "vegan"],
        modifierGroups: ["temperature", "ice-level", "espresso-shots", "syrups"],
      },
      {
        slug: "mocha",
        name: "Island Mocha",
        description: "Dark chocolate, espresso, steamed milk.",
        sizes: DRINK_SIZES,
        allergens: ["dairy"],
        dietary: ["contains_caffeine", "vegetarian"],
        modifierGroups: HOT_DRINK_GROUPS,
      },
    ],
  },
  {
    slug: "tropical-refreshers",
    name: "Tropical Refreshers",
    description: "Bright, fruity and built for a warm afternoon.",
    products: [
      {
        slug: "pog-refresher",
        name: "POG Refresher",
        description: "Passion fruit, orange and guava over ice.",
        sizes: DRINK_SIZES,
        dietary: ["vegan", "dairy_free"],
        modifierGroups: COLD_DRINK_GROUPS,
        catering: true,
      },
      {
        slug: "lilikoi-lemonade",
        name: "Lilikoʻi Lemonade",
        description: "Fresh lemonade with passion fruit.",
        sizes: DRINK_SIZES,
        dietary: ["vegan", "dairy_free"],
        modifierGroups: COLD_DRINK_GROUPS,
        catering: true,
      },
      {
        slug: "mango-sunrise",
        name: "Mango Sunrise",
        description: "Mango, a splash of guava, and a slow sunrise fade.",
        sizes: DRINK_SIZES,
        dietary: ["vegan", "dairy_free"],
        modifierGroups: COLD_DRINK_GROUPS,
        catering: true,
      },
      {
        slug: "coconut-cream-soda",
        name: "Coconut Cream Soda",
        description: "Sparkling, creamy, toasted coconut on top.",
        sizes: [["Medium", 5.25, 16], ["Large", 6.0, 24]],
        dietary: ["vegetarian"],
        modifierGroups: ["sweetness", "ice-level", "toppings"],
      },
      {
        slug: "strawberry-guava-cooler",
        name: "Strawberry Guava Cooler",
        description: "Strawberry and guava with a li hing rim.",
        sizes: DRINK_SIZES,
        dietary: ["vegan", "dairy_free"],
        modifierGroups: COLD_DRINK_GROUPS,
      },
    ],
  },
  {
    slug: "tea",
    name: "Tea",
    description: "Loose leaf, brewed fresh daily.",
    products: [
      {
        slug: "jasmine-green-tea",
        name: "Jasmine Green Tea",
        description: "Floral and light, hot or iced.",
        sizes: DRINK_SIZES,
        dietary: ["vegan", "contains_caffeine"],
        modifierGroups: ["temperature", "ice-level", "sweetness", "toppings"],
        catering: true,
      },
      {
        slug: "guava-iced-tea",
        name: "Guava Iced Tea",
        description: "Black tea with guava, not too sweet.",
        sizes: DRINK_SIZES,
        dietary: ["vegan", "contains_caffeine"],
        modifierGroups: ["sweetness", "ice-level", "toppings"],
        catering: true,
      },
      {
        slug: "matcha-latte",
        name: "Matcha Latte",
        description: "Ceremonial grade matcha, whisked to order.",
        sizes: DRINK_SIZES,
        allergens: ["dairy"],
        dietary: ["vegetarian", "contains_caffeine"],
        modifierGroups: ["temperature", "ice-level", "milk", "syrups", "sweetness"],
        catering: true,
      },
    ],
  },
  {
    slug: "blended",
    name: "Blended",
    description: "Thick, frosty and stirred with a straw.",
    products: [
      {
        slug: "mango-coconut-blended",
        name: "Mango Coconut Blended",
        description: "Mango and coconut milk, blended smooth.",
        sizes: [["Medium", 6.75, 16], ["Large", 7.75, 24]],
        dietary: ["vegan", "dairy_free"],
        modifierGroups: ["sweetness", "toppings", "signature-addons"],
      },
      {
        slug: "kona-coffee-frappe",
        name: "Kona Coffee Frappé",
        description: "Blended cold brew with a cocoa dusting.",
        sizes: [["Medium", 6.95, 16], ["Large", 7.95, 24]],
        allergens: ["dairy"],
        dietary: ["vegetarian", "contains_caffeine"],
        modifierGroups: ["milk", "espresso-shots", "syrups", "toppings", "signature-addons"],
      },
      {
        slug: "strawberry-guava-smoothie",
        name: "Strawberry Guava Smoothie",
        description: "Real fruit, no syrup shortcuts.",
        sizes: [["Medium", 6.95, 16], ["Large", 7.95, 24]],
        dietary: ["vegan", "dairy_free"],
        modifierGroups: ["sweetness", "toppings"],
      },
      {
        slug: "matcha-blended",
        name: "Matcha Blended",
        description: "Matcha, milk and ice, whipped together.",
        sizes: [["Medium", 6.95, 16], ["Large", 7.95, 24]],
        allergens: ["dairy"],
        dietary: ["vegetarian", "contains_caffeine"],
        modifierGroups: ["milk", "sweetness", "toppings", "signature-addons"],
      },
    ],
  },
  {
    slug: "shave-ice",
    name: "Shave Ice",
    description: "Fluffy, snow-soft ice with island syrups.",
    products: [
      {
        slug: "classic-shave-ice",
        name: "Classic Shave Ice",
        description: "Pick up to three flavors.",
        sizes: [["Regular", 5.5, 12], ["Large", 7.0, 20]],
        dietary: ["vegan", "dairy_free"],
        modifierGroups: ["shave-ice-flavors", "shave-ice-addons"],
      },
      {
        slug: "rainbow-shave-ice",
        name: "Rainbow Shave Ice",
        description: "Strawberry, lilikoʻi and blue vanilla, side by side.",
        sizes: [["Regular", 6.0, 12], ["Large", 7.5, 20]],
        dietary: ["vegan", "dairy_free"],
        modifierGroups: ["shave-ice-addons"],
      },
      {
        slug: "snow-cap-sundae",
        name: "Snow Cap Sundae",
        description: "Shave ice over ice cream, azuki beans and a snow cap.",
        sizes: [["Regular", 8.25, 16]],
        allergens: ["dairy"],
        dietary: ["vegetarian"],
        modifierGroups: ["shave-ice-flavors", "shave-ice-addons"],
      },
    ],
  },
  {
    slug: "food-snacks",
    name: "Food & Snacks",
    description: "Something to go with it.",
    products: [
      {
        slug: "macadamia-cookie",
        name: "Macadamia Nut Cookie",
        description: "Baked in-house, crisp at the edge.",
        basePrice: 3.75,
        allergens: ["dairy", "gluten", "egg", "tree_nuts", "macadamia"],
        dietary: ["vegetarian"],
        modifierGroups: [],
        catering: true,
      },
      {
        slug: "banana-bread",
        name: "Banana Bread",
        description: "Thick slice, toasted on request.",
        basePrice: 4.5,
        allergens: ["dairy", "gluten", "egg"],
        dietary: ["vegetarian"],
        modifierGroups: [],
        catering: true,
      },
      {
        slug: "teriyaki-musubi",
        name: "Teriyaki Musubi",
        description: "Rice, nori and teriyaki glaze.",
        basePrice: 4.25,
        allergens: ["soy", "sesame"],
        modifierGroups: [],
        catering: true,
      },
      {
        slug: "malasada",
        name: "Malasada",
        description: "Warm, sugared, made fresh each morning.",
        basePrice: 3.25,
        allergens: ["dairy", "gluten", "egg"],
        dietary: ["vegetarian"],
        modifierGroups: [],
        catering: true,
      },
    ],
  },
];

async function seedCatalog(groupIds: Map<string, string>, optionIds: Map<string, string>) {
  const productIds = new Map<string, string>();

  for (const [categoryIndex, category] of CATALOG.entries()) {
    const categoryRow = ok(
      await db
        .from("categories")
        .insert({
          name: category.name,
          slug: category.slug,
          description: category.description,
          sort_order: categoryIndex * 10,
        })
        .select()
        .single(),
      `insert category ${category.slug}`,
    );

    for (const [productIndex, product] of category.products.entries()) {
      const productRow = ok(
        await db
          .from("products")
          .insert({
            category_id: categoryRow.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            base_price_cents: product.basePrice ? dollars(product.basePrice) : 0,
            allergens: product.allergens ?? [],
            dietary_tags: product.dietary ?? [],
            is_catering_eligible: product.catering ?? false,
            sort_order: productIndex * 10,
          })
          .select()
          .single(),
        `insert product ${product.slug}`,
      );

      productIds.set(product.slug, productRow.id);

      if (product.sizes) {
        ok(
          await db
            .from("product_sizes")
            .insert(
              product.sizes.map(([name, price, oz], index) => ({
                product_id: productRow.id,
                name,
                price_cents: dollars(price),
                volume_oz: oz,
                // Middle size is the default where there are three.
                is_default: product.sizes!.length > 2 ? index === 1 : index === 0,
                sort_order: index * 10,
              })),
            )
            .select(),
          `insert sizes for ${product.slug}`,
        );
      }

      if (product.modifierGroups.length > 0) {
        ok(
          await db
            .from("product_modifier_groups")
            .insert(
              product.modifierGroups.map((slug, index) => {
                const groupId = groupIds.get(slug);
                if (!groupId) throw new Error(`Unknown modifier group '${slug}' on ${product.slug}`);

                const condition = CONDITIONAL_GROUPS.find(
                  (rule) => rule.group === slug && product.modifierGroups.includes(rule.whenGroup),
                );
                const visibleWhen = condition
                  ? optionIds.get(`${condition.whenGroup}/${condition.whenOption}`)
                  : undefined;
                if (condition && !visibleWhen) {
                  throw new Error(`Unknown option ${condition.whenGroup}/${condition.whenOption}`);
                }

                return {
                  product_id: productRow.id,
                  modifier_group_id: groupId,
                  sort_order: index * 10,
                  visible_when_option_id: visibleWhen ?? null,
                };
              }),
            )
            .select(),
          `link modifiers for ${product.slug}`,
        );
      }
    }
  }

  return productIds;
}

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

async function seedEventMenu(eventId: string, productIds: Map<string, string>) {
  const eventProducts = [
    "cold-brew",
    "pog-refresher",
    "lilikoi-lemonade",
    "guava-iced-tea",
    "classic-shave-ice",
    "rainbow-shave-ice",
    "macadamia-cookie",
  ];

  ok(
    await db
      .from("event_menu_items")
      .insert(
        eventProducts.map((slug, index) => ({
          location_id: eventId,
          product_id: productIds.get(slug)!,
          sort_order: index * 10,
        })),
      )
      .select(),
    "insert event menu",
  );
}

/**
 * One sold-out product and one sold-out option at the cafe, so the badges and
 * disabled states are visible without first signing in to /staff.
 */
async function seedSoldOut(cafeId: string, productIds: Map<string, string>, optionIds: Map<string, string>) {
  ok(
    await db
      .from("location_availability")
      .insert([
        {
          location_id: cafeId,
          product_id: productIds.get("banana-bread")!,
          is_available: false,
          reason: "Demo: sold out for the day",
        },
        {
          location_id: cafeId,
          modifier_option_id: optionIds.get("milk/Macadamia milk")!,
          is_available: false,
          reason: "Demo: out of macadamia milk",
        },
      ])
      .select(),
    "insert sold-out overrides",
  );
}

async function seedCollection(productIds: Map<string, string>) {
  const start = new Date();
  start.setDate(start.getDate() - 7);
  const end = new Date();
  end.setDate(end.getDate() + 60);

  const collection = ok(
    await db
      .from("collections")
      .insert({
        name: "Summer Sunset",
        slug: "summer-sunset",
        description: "Warm-weather flavors while the light lasts.",
        accent_color: "#E0409B",
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
      })
      .select()
      .single(),
    "insert collection",
  );

  const members = ["mango-sunrise", "lilikoi-lemonade", "rainbow-shave-ice", "coconut-cream-soda"];

  ok(
    await db
      .from("collection_products")
      .insert(
        members.map((slug, index) => ({
          collection_id: collection.id,
          product_id: productIds.get(slug)!,
          sort_order: index * 10,
        })),
      )
      .select(),
    "insert collection products",
  );
}

/**
 * Overflow Rewards tiers. NEEDS_CONFIRMATION: costs, caps and what each
 * covers are stand-ins until the owner decides. At the default 1 point per
 * dollar each tier gives back about 5 cents a point.
 *
 * The top tier is a fixed amount off rather than "a free drink and a
 * pastry": one reward row is one discount, and a bundle would need two free
 * lines with two caps. $12.50 is roughly a capped drink plus a pastry.
 */
async function seedRewardsAndPromos() {
  const slugsToIds = async (table: "categories" | "modifier_groups", slugs: string[]) => {
    const rows = ok(await db.from(table).select("id, slug").in("slug", slugs), `look up ${table}`);
    return slugs.map((slug) => {
      const row = rows.find((r) => r.slug === slug);
      if (!row) throw new Error(`seed rewards: no ${table} row "${slug}"`);
      return row.id;
    });
  };
  const drinkCategories = await slugsToIds("categories", ["coffee-espresso", "tropical-refreshers", "tea", "blended"]);
  const addOnGroups = await slugsToIds("modifier_groups", ["syrups", "toppings", "espresso-shots"]);

  ok(
    await db
      .from("rewards")
      .insert([
        {
          name: "Free add-on",
          description: "A flavor, a topping or an extra shot, on us.",
          points_cost: 50,
          type: "free_modifier",
          applicable_modifier_group_ids: addOnGroups,
          eligibility_label: "a flavor, topping or extra shot",
          sort_order: 0,
        },
        {
          name: "Free drink",
          description: "Any drink on the menu, any size, up to $7.50.",
          points_cost: 150,
          type: "free_item",
          value_cents: 750,
          covers_modifiers: false,
          applicable_category_ids: drinkCategories,
          eligibility_label: "any drink",
          sort_order: 10,
        },
        {
          name: "$12.50 off",
          description: "Treat yourself (or a friend): $12.50 off your order.",
          points_cost: 250,
          type: "amount_off",
          value_cents: 1250,
          sort_order: 20,
        },
        // Columns a row leaves out take their defaults rather than null.
      ], { defaultToNull: false })
      .select(),
    "insert rewards",
  );

  const endsAt = new Date();
  endsAt.setMonth(endsAt.getMonth() + 3);

  ok(
    await db
      .from("promos")
      .insert([
        {
          code: "MAHALO10",
          description: "10% off, thanks for ordering ahead.",
          type: "percent",
          percent: 10,
          min_spend_cents: 1000,
          max_discount_cents: 500,
          usage_limit: 500,
          per_user_limit: 3,
          ends_at: endsAt.toISOString(),
        },
        {
          code: "ALOHA5",
          description: "$5 off orders over $25.",
          type: "fixed",
          amount_cents: 500,
          min_spend_cents: 2500,
          per_user_limit: 1,
          ends_at: endsAt.toISOString(),
        },
      ])
      .select(),
    "insert promos",
  );

  // Expired. Checkout must answer exactly as it does for a code that never
  // existed, so codes cannot be probed.
  const day = 24 * 60 * 60 * 1000;
  ok(
    await db
      .from("promos")
      .insert({
        code: "SPRING24",
        description: "Expired demo code.",
        type: "percent",
        percent: 20,
        starts_at: new Date(Date.now() - 400 * day).toISOString(),
        ends_at: new Date(Date.now() - 300 * day).toISOString(),
      })
      .select(),
    "insert expired promo",
  );
}

async function seedAccounts(cafeId: string, eventId: string) {
  const ids: Record<string, string> = {};

  for (const account of TEST_ACCOUNTS) {
    const created = await db.auth.admin.createUser({
      email: account.email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });

    if (created.error || !created.data.user) {
      throw new Error(`create ${account.email}: ${created.error?.message ?? "no user"}`);
    }

    const userId = created.data.user.id;
    ids[account.role] = userId;

    // The handle_new_user trigger created the profile; set the role on it.
    const { error } = await db
      .from("profiles")
      .update({ role: account.role, phone: "+18085550101" })
      .eq("id", userId);
    if (error) throw new Error(`set role for ${account.email}: ${error.message}`);
  }

  // Roster the barista onto both counters.
  ok(
    await db
      .from("staff_locations")
      .insert([
        { profile_id: ids.staff, location_id: cafeId },
        { profile_id: ids.staff, location_id: eventId },
      ])
      .select(),
    "insert staff roster",
  );

  return ids;
}

async function seedCatering(customerId: string, cafeId: string, productIds: Map<string, string>) {
  const inTwoWeeks = new Date();
  inTwoWeeks.setDate(inTwoWeeks.getDate() + 14);

  const inSixWeeks = new Date();
  inSixWeeks.setDate(inSixWeeks.getDate() + 42);

  const requests = ok(
    await db
      .from("catering_requests")
      .insert([
        {
          user_id: customerId,
          contact_name: "Leilani Customer",
          contact_email: "customer@drincup.test",
          contact_phone: "+18085550101",
          event_at: inTwoWeeks.toISOString(),
          headcount: 30,
          fulfillment: "pickup",
          budget_cents: 45000,
          notes: "Office anniversary. Half iced coffee, half refreshers if possible.",
          status: "submitted",
        },
        {
          user_id: customerId,
          contact_name: "Leilani Customer",
          contact_email: "customer@drincup.test",
          event_at: inSixWeeks.toISOString(),
          headcount: 75,
          fulfillment: "delivery",
          delivery_address: "500 Ala Moana Blvd, Honolulu, HI 96813",
          budget_cents: 120000,
          custom_drink_request: "Something with lilikoʻi for a launch party — our brand color is teal.",
          notes: "Would love a custom signature drink.",
          status: "submitted",
        },
      ])
      .select(),
    "insert catering requests",
  );

  ok(
    await db
      .from("catering_request_items")
      .insert([
        {
          catering_request_id: requests[0].id,
          product_id: productIds.get("cold-brew")!,
          product_name: "Cold Brew",
          quantity: 15,
        },
        {
          catering_request_id: requests[0].id,
          product_id: productIds.get("pog-refresher")!,
          product_name: "POG Refresher",
          quantity: 15,
        },
        {
          catering_request_id: requests[1].id,
          product_id: null,
          product_name: "Custom signature drink",
          quantity: 75,
          notes: "Lilikoʻi based, teal coloured.",
        },
      ])
      .select(),
    "insert catering items",
  );

  await seedTodaysCatering(customerId, cafeId, productIds);
}

/**
 * A confirmed request for today at noon (Honolulu), so the staff screen's
 * "Today's catering" prep list has something on it. The lead-time trigger
 * only checks inserts, so it is created next week, then moved to today and
 * walked through quoted → confirmed the way an admin would.
 */
async function seedTodaysCatering(customerId: string, cafeId: string, productIds: Map<string, string>) {
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const request = ok(
    await db
      .from("catering_requests")
      .insert({
        user_id: customerId,
        location_id: cafeId,
        contact_name: "Malia Office Manager",
        contact_email: "customer@drincup.test",
        contact_phone: "+18085550123",
        event_at: nextWeek.toISOString(),
        headcount: 12,
        fulfillment: "pickup",
        notes: "Team meeting. Please label each drink with the name on the list we emailed.",
        status: "submitted",
      })
      .select()
      .single(),
    "insert today's catering request",
  );

  ok(
    await db
      .from("catering_request_items")
      .insert([
        { catering_request_id: request.id, product_id: productIds.get("latte")!, product_name: "Latte", quantity: 6, notes: "3 oat, 3 whole" },
        { catering_request_id: request.id, product_id: productIds.get("pog-refresher")!, product_name: "POG Refresher", quantity: 6 },
      ])
      .select(),
    "insert today's catering items",
  );

  // Noon today in Honolulu: the HST date, then 12:00 at UTC-10.
  const hstDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu" }).format(new Date());
  const noonToday = new Date(`${hstDate}T12:00:00-10:00`).toISOString();
  for (const update of [
    { event_at: noonToday },
    { status: "quoted" as const, quote_amount_cents: 9600 },
    { status: "confirmed" as const },
  ]) {
    ok(
      await db.from("catering_requests").update(update).eq("id", request.id).select().single(),
      "confirm today's catering request",
    );
  }
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`Seeding ${SUPABASE_URL} ...`);

  await wipe();
  console.log("  cleared existing data");

  const { cafe, event } = await seedLocations();
  console.log("  locations + hours");

  const { groupIds, optionIds } = await seedModifiers();
  console.log(`  ${groupIds.size} modifier groups`);

  const productIds = await seedCatalog(groupIds, optionIds);
  console.log(`  ${CATALOG.length} categories, ${productIds.size} products`);

  await seedEventMenu(event.id, productIds);
  await seedSoldOut(cafe.id, productIds, optionIds);
  await seedCollection(productIds);
  await seedRewardsAndPromos();
  console.log("  event menu, sold-out demo, seasonal collection, rewards, promos");

  const ids = await seedAccounts(cafe.id, event.id);
  console.log("  test accounts");

  await seedCatering(ids.customer, cafe.id, productIds);
  console.log("  catering requests");

  console.log("\nDone. Test accounts (password for all: " + TEST_PASSWORD + "):");
  for (const account of TEST_ACCOUNTS) {
    console.log(`  ${account.role.padEnd(8)} ${account.email}`);
  }
}

main().catch((error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});

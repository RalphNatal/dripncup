/**
 * The menu spreadsheet's layout: its columns, what goes in each, and the
 * filled-in example. The template downloads (CSV and XLSX), the parser and
 * the README all follow this file.
 */
import type { Enums } from "@/types/database";

export interface ImportColumn {
  key: "category" | "product" | "slug" | "description" | "price" | "sizes" | "modifier_groups" | "allergens" | "dietary" | "catering" | "active";
  header: string;
  required: boolean;
  /** Spreadsheet column width, in characters. */
  width: number;
  /** Formatted as Text in the XLSX template, so 5.50 is not turned into 5.5. */
  text?: boolean;
  help: string;
  example: string;
}

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  {
    key: "category", header: "Category", required: true, width: 22,
    help: "The menu section, e.g. Coffee & Espresso. A new name makes a new category.",
    example: "Coffee & Espresso",
  },
  {
    key: "product", header: "Product", required: true, width: 28,
    help: "The item's name as customers see it.",
    example: "Ube Latte",
  },
  {
    key: "slug", header: "Slug", required: false, width: 24,
    help: "Optional web address, e.g. ube-latte. Leave blank to make one from the name. Importing again matches items by this, so keep it the same to update an item.",
    example: "ube-latte",
  },
  {
    key: "description", header: "Description", required: false, width: 48,
    help: "One or two sentences.",
    example: "Purple yam, espresso and milk.",
  },
  {
    key: "price", header: "Price", required: false, width: 10, text: true,
    help: "For items with one price (a pastry): dollars and cents, like 3.75. No $ sign. Leave blank when you fill in Sizes.",
    example: "",
  },
  {
    key: "sizes", header: "Sizes", required: false, width: 36, text: true,
    help: "For items with sizes: Name=price, separated by semicolons, like Small=5.25; Medium*=6.00; Large=6.75. A * marks the size picked by default (else the first).",
    example: "Small=5.75; Medium*=6.50; Large=7.25",
  },
  {
    key: "modifier_groups", header: "Modifier groups", required: false, width: 40,
    help: "The customisation groups to offer, by their short name from the Modifiers page, separated by semicolons. Add \"if <option>\" to show a group only when that option is picked, like ice-level if Iced.",
    example: "temperature; ice-level if Iced; milk; espresso-shots; syrups",
  },
  {
    key: "allergens", header: "Allergens", required: false, width: 22,
    help: "Any of: dairy, tree nuts, macadamia, peanuts, gluten, soy, egg, sesame. Separate with commas.",
    example: "dairy",
  },
  {
    key: "dietary", header: "Dietary", required: false, width: 26,
    help: "Any of: vegan, vegetarian, dairy free, gluten free, nut free, contains caffeine, decaf.",
    example: "contains caffeine, vegetarian",
  },
  {
    key: "catering", header: "Catering", required: false, width: 10,
    help: "yes if it can be ordered for catering. Blank means no.",
    example: "yes",
  },
  {
    key: "active", header: "Active", required: false, width: 8,
    help: "no to add it switched off (hidden from customers). Blank means yes.",
    example: "yes",
  },
];

export const ALLERGENS: readonly Enums<"allergen">[] = ["dairy", "tree_nuts", "macadamia", "peanuts", "gluten", "soy", "egg", "sesame"];
export const DIETARY_TAGS: readonly Enums<"dietary_tag">[] = [
  "vegan", "vegetarian", "dairy_free", "gluten_free", "nut_free", "contains_caffeine", "decaf",
];

/**
 * The filled-in example: real-looking items that are not in the seeded
 * menu (importing it adds them; importing again changes nothing). The
 * categories match the seed's by name, plus one new one. Modifier groups
 * are the seeded ones' short names.
 */
export const EXAMPLE_ROWS: readonly (readonly string[])[] = [
  ["Coffee & Espresso", "Ube Latte", "ube-latte", "Purple yam, espresso and milk.", "", "Small=5.75; Medium*=6.50; Large=7.25",
    "temperature; ice-level if Iced; milk; espresso-shots; syrups", "dairy", "contains caffeine, vegetarian", "yes", "yes"],
  ["Coffee & Espresso", "Hōjicha Latte", "hojicha-latte", "Roasted Japanese green tea with steamed milk.", "", "Small=5.25; Medium*=6.00",
    "temperature; ice-level if Iced; milk; sweetness", "dairy", "contains caffeine, vegetarian", "yes", "yes"],
  ["Tropical Refreshers", "Lilikoʻi Hibiscus Cooler", "lilikoi-hibiscus-cooler", "Passion fruit and hibiscus over ice.", "", "Medium*=5.50; Large=6.25",
    "sweetness; ice-level; toppings", "", "vegan", "yes", "yes"],
  ["Food & Snacks", "Spam Musubi", "spam-musubi", "Grilled Spam on rice, wrapped in nori.", "3.75", "", "", "gluten, soy", "", "yes", "yes"],
  ["Bakery", "Butter Mochi", "butter-mochi", "Chewy coconut-butter mochi cake.", "3.25", "", "", "dairy, egg", "vegetarian, gluten free", "yes", "yes"],
  ["Bakery", "Haupia Pie Slice", "haupia-pie-slice", "Coconut haupia on a shortbread crust.", "4.50", "", "", "dairy, gluten", "vegetarian", "no", "yes"],
];

export const TEMPLATE_HEADERS: readonly string[] = IMPORT_COLUMNS.map((c) => c.header);

/** The "How to fill" sheet / section: one row per column. */
export const TEMPLATE_HELP_ROWS: readonly (readonly string[])[] = [
  ["Column", "Required", "What to put", "Example"],
  ...IMPORT_COLUMNS.map((c) => [c.header, c.required ? "Yes" : "No", c.help, c.example]),
];

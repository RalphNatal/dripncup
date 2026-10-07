/**
 * Menu spreadsheet rows -> a checked import plan, or row-by-row errors.
 *
 * Pure: the caller reads the file (./file.ts) and the current modifier
 * groups; nothing here touches the database. The plan is what
 * admin_import_menu() applies, and it validates again.
 *
 * Strict on purpose, because a typo here changes prices customers pay:
 *   - prices are dollars and cents with two decimals ("5.50"); "$5", "5.5"
 *     and "5" are refused with a message saying how to write them (a number
 *     cell in an .xlsx with at most two decimals is fine: 5.5 there is
 *     unambiguous)
 *   - a cell that starts with =, +, -, @ (a spreadsheet formula, or an
 *     attempt to plant one) is refused, and so is any real formula cell
 *   - unknown modifier groups, allergens or dietary tags are errors, never
 *     silently dropped
 */
import { slugify } from "@/lib/events/window";
import type { Enums } from "@/types/database";

import { ALLERGENS, DIETARY_TAGS, IMPORT_COLUMNS, type ImportColumn } from "./format";
import type { SheetCell } from "./xlsx";

export const MAX_IMPORT_ROWS = 1000;

export interface KnownGroup {
  id: string;
  slug: string;
  name: string;
  options: { id: string; name: string }[];
}

export interface ImportRowError {
  /** Spreadsheet row number (the header is row 1); 0 = the whole file. */
  row: number;
  column: string | null;
  message: string;
}

export interface PlanGroup {
  slug: string;
  name: string;
  /** "Only show when" this option (from another listed group) is picked. */
  when: { optionId: string; optionName: string } | null;
}

export interface PlanProduct {
  row: number;
  slug: string;
  name: string;
  description: string | null;
  categorySlug: string;
  categoryName: string;
  basePriceCents: number;
  sizes: { name: string; priceCents: number; isDefault: boolean }[];
  groups: PlanGroup[];
  allergens: Enums<"allergen">[];
  dietaryTags: Enums<"dietary_tag">[];
  cateringEligible: boolean;
  active: boolean;
}

export interface ImportPlan {
  categories: { slug: string; name: string }[];
  products: PlanProduct[];
}

export interface ParseResult {
  plan: ImportPlan;
  errors: ImportRowError[];
  /** Data rows read (blank rows not counted). */
  rowCount: number;
}

const FORMULA_START = /^[=+\-@\t\r]/;
const PRICE = /^\d{1,4}\.\d{2}$/;

const norm = (text: string) => text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "tree nuts", "Tree-Nuts", "tree_nuts" -> "tree_nuts". */
const enumKey = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const DIETARY_SYNONYMS: Record<string, Enums<"dietary_tag">> = { caffeine: "contains_caffeine", caffeinated: "contains_caffeine", gf: "gluten_free", df: "dairy_free" };
const ALLERGEN_SYNONYMS: Record<string, Enums<"allergen">> = { nuts: "tree_nuts", tree_nut: "tree_nuts", milk: "dairy", eggs: "egg", peanut: "peanuts" };

/** "Price" -> its column index in this file. */
function headerMap(header: SheetCell[]): { map: Map<ImportColumn["key"], number>; errors: ImportRowError[] } {
  const map = new Map<ImportColumn["key"], number>();
  const errors: ImportRowError[] = [];
  const byName = new Map(IMPORT_COLUMNS.flatMap((c) => [[norm(c.header), c.key] as const, [norm(c.key), c.key] as const]));
  header.forEach((cell, index) => {
    const key = byName.get(norm(cell.text));
    if (key && !map.has(key)) map.set(key, index);
  });
  for (const column of IMPORT_COLUMNS) {
    if (column.required && !map.has(column.key)) {
      errors.push({ row: 1, column: column.header, message: `The "${column.header}" column is missing. Start from the template.` });
    }
  }
  if (!map.has("price") && !map.has("sizes")) {
    errors.push({ row: 1, column: null, message: 'Add a "Price" column, a "Sizes" column, or both.' });
  }
  return { map, errors };
}

/** Dollars and cents -> cents, or the reason it can't be read. */
export function parsePrice(cell: SheetCell): { cents: number } | { error: string } {
  const text = cell.text.trim();
  if (cell.kind === "number") {
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0 || value > 1000) return { error: "Prices must be from 0.00 to 1000.00." };
    const cents = Math.round(value * 100);
    if (Math.abs(cents - value * 100) > 1e-6) return { error: `“${text}” has more than two decimals. Write it like 5.50.` };
    return { cents };
  }
  return parsePriceText(text);
}

function parsePriceText(text: string): { cents: number } | { error: string } {
  if (/^\$/.test(text)) return { error: `Write “${text}” without the $ sign, like ${text.slice(1).trim() || "5.00"}.` };
  if (/^\d+$/.test(text)) return { error: `Write “${text}” with cents, like ${text}.00.` };
  if (/^\d+\.\d$/.test(text)) return { error: `Write “${text}” with two decimals, like ${text}0.` };
  if (/,/.test(text)) return { error: `Write “${text}” without commas, like 5.50.` };
  if (!PRICE.test(text)) return { error: `“${text}” isn't a price. Write dollars and cents, like 5.50.` };
  const cents = Math.round(Number(text) * 100);
  if (cents > 100_000) return { error: "Prices must be from 0.00 to 1000.00." };
  return { cents };
}

const splitList = (text: string) =>
  text
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const splitTags = (text: string) =>
  text
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

function yesNo(text: string, blank: boolean): boolean | null {
  const t = text.trim().toLowerCase();
  if (t === "") return blank;
  if (["yes", "y", "true", "1", "x"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  return null;
}

export function parseMenuRows(rows: readonly (readonly SheetCell[])[], groups: readonly KnownGroup[]): ParseResult {
  const errors: ImportRowError[] = [];
  const plan: ImportPlan = { categories: [], products: [] };
  const firstNonEmpty = rows.findIndex((r) => r.some((c) => c.text.trim() !== ""));
  if (firstNonEmpty < 0) {
    return { plan, errors: [{ row: 0, column: null, message: "The file is empty." }], rowCount: 0 };
  }

  const { map, errors: headerErrors } = headerMap([...rows[firstNonEmpty]]);
  if (headerErrors.length) return { plan, errors: headerErrors, rowCount: 0 };

  const groupByKey = new Map<string, KnownGroup>();
  for (const group of groups) {
    groupByKey.set(norm(group.slug), group);
    if (!groupByKey.has(norm(group.name))) groupByKey.set(norm(group.name), group);
  }
  const categories = new Map<string, string>();
  const seenSlugs = new Map<string, number>();
  let rowCount = 0;

  for (let index = firstNonEmpty + 1; index < rows.length; index += 1) {
    const cells = rows[index];
    const rowNumber = index + 1;
    if (!cells.some((c) => c.text.trim() !== "")) continue;
    rowCount += 1;
    if (rowCount > MAX_IMPORT_ROWS) {
      errors.push({ row: 0, column: null, message: `A file can hold up to ${MAX_IMPORT_ROWS} items. Split it into smaller files.` });
      break;
    }

    const rowErrors: ImportRowError[] = [];
    const fail = (column: ImportColumn["key"] | null, message: string) =>
      rowErrors.push({ row: rowNumber, column: column ? IMPORT_COLUMNS.find((c) => c.key === column)!.header : null, message });

    // Formulas, real or planted, anywhere in the row.
    cells.forEach((cell, col) => {
      const column = [...map.entries()].find(([, i]) => i === col)?.[0] ?? null;
      if (cell.kind === "formula") fail(column, "Formulas aren't allowed. Copy the cells and paste them back as values.");
      else if (cell.kind === "error") fail(column, "This cell shows a spreadsheet error.");
      else if (cell.kind === "text" && FORMULA_START.test(cell.text)) {
        fail(column, `Cells can't start with “${cell.text[0] === "\t" ? "tab" : cell.text[0]}” (spreadsheets treat that as a formula). Remove the first character.`);
      }
    });
    const get = (key: ImportColumn["key"]): SheetCell => {
      const i = map.get(key);
      return i === undefined ? { text: "", kind: "text" } : (cells[i] ?? { text: "", kind: "text" });
    };
    const text = (key: ImportColumn["key"]) => get(key).text.trim();

    const categoryName = text("category");
    const name = text("product");
    if (!categoryName) fail("category", "Missing category.");
    else if (categoryName.length > 60) fail("category", "Keep the category name to 60 characters.");
    if (!name) fail("product", "Missing product name.");
    else if (name.length > 80) fail("product", "Keep the product name to 80 characters.");

    const categorySlug = slugify(categoryName).slice(0, 80);
    if (categoryName && !categorySlug) fail("category", "Use letters or numbers in the category name.");

    let slug = text("slug").toLowerCase();
    if (slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail("slug", "Slugs use lowercase letters, numbers and single hyphens, like ube-latte.");
    if (!slug) slug = slugify(name).slice(0, 80).replace(/-+$/, "");
    if (slug.length > 80) fail("slug", "Keep the slug to 80 characters.");
    if (slug && seenSlugs.has(slug)) fail("slug", `Row ${seenSlugs.get(slug)} already has “${slug}”. Each item needs its own slug.`);

    const description = text("description");
    if (description.length > 1000) fail("description", "Keep the description to 1,000 characters.");

    // Price or sizes.
    const priceCell = get("price");
    const sizesText = text("sizes");
    let basePriceCents = 0;
    const sizes: PlanProduct["sizes"] = [];
    if (priceCell.text.trim() && sizesText) {
      fail("price", "Give a price or sizes, not both.");
    } else if (!priceCell.text.trim() && !sizesText) {
      fail("price", "Missing price. Give a price, or sizes with prices.");
    } else if (priceCell.text.trim()) {
      if (priceCell.kind !== "formula") {
        const price = parsePrice(priceCell);
        if ("error" in price) fail("price", price.error);
        else basePriceCents = price.cents;
      }
    } else {
      const entries = splitList(sizesText);
      if (entries.length > 10) fail("sizes", "Up to 10 sizes.");
      let defaults = 0;
      for (const entry of entries) {
        const match = /^(.+?)\s*(\*?)\s*=\s*(.+)$/.exec(entry);
        if (!match) {
          fail("sizes", `“${entry}” should look like Medium=5.25.`);
          continue;
        }
        const sizeName = match[1].trim();
        const price = parsePriceText(match[3].trim());
        if (sizeName.length > 40) fail("sizes", `Keep the size name “${sizeName}” to 40 characters.`);
        if ("error" in price) {
          fail("sizes", `${sizeName}: ${price.error}`);
          continue;
        }
        if (sizes.some((s) => s.name.toLowerCase() === sizeName.toLowerCase())) {
          fail("sizes", `“${sizeName}” is listed twice.`);
          continue;
        }
        if (match[2]) defaults += 1;
        sizes.push({ name: sizeName, priceCents: price.cents, isDefault: Boolean(match[2]) });
      }
      if (defaults > 1) fail("sizes", "Mark only one size with *.");
      if (defaults === 0 && sizes.length > 0) sizes[0].isDefault = true;
    }

    // Modifier groups, with optional "if <option>" conditions.
    const planGroups: PlanGroup[] = [];
    const conditions: { group: KnownGroup; optionText: string }[] = [];
    for (const token of splitList(text("modifier_groups").replace(/,/g, ";"))) {
      const match = /^(.+?)\s+if\s+(.+)$/i.exec(token);
      const groupText = (match ? match[1] : token).trim();
      const group = groupByKey.get(norm(groupText));
      if (!group) {
        fail("modifier_groups", `Unknown modifier group “${groupText}”. Use a short name from the Modifiers page, or create the group first.`);
        continue;
      }
      if (planGroups.some((g) => g.slug === group.slug)) {
        fail("modifier_groups", `“${group.slug}” is listed twice.`);
        continue;
      }
      planGroups.push({ slug: group.slug, name: group.name, when: null });
      if (match) conditions.push({ group, optionText: match[2].trim() });
    }
    for (const { group, optionText } of conditions) {
      const others = planGroups.filter((g) => g.slug !== group.slug).map((g) => groupByKey.get(norm(g.slug))!);
      const options = others.flatMap((g) => g.options.filter((o) => norm(o.name) === norm(optionText)));
      const target = planGroups.find((g) => g.slug === group.slug)!;
      if (options.length === 1) target.when = { optionId: options[0].id, optionName: options[0].name };
      else if (options.length === 0) fail("modifier_groups", `${group.slug} if ${optionText}: no other group on this item has an option called “${optionText}”.`);
      else fail("modifier_groups", `${group.slug} if ${optionText}: more than one group has “${optionText}”. Rename one of the options.`);
    }

    // Allergens and dietary tags.
    const allergens: Enums<"allergen">[] = [];
    for (const tag of splitTags(text("allergens"))) {
      const key = enumKey(tag);
      const value = (ALLERGENS as readonly string[]).includes(key) ? (key as Enums<"allergen">) : ALLERGEN_SYNONYMS[key];
      if (!value) fail("allergens", `Unknown allergen “${tag}”. Use: dairy, tree nuts, macadamia, peanuts, gluten, soy, egg, sesame.`);
      else if (!allergens.includes(value)) allergens.push(value);
    }
    const dietaryTags: Enums<"dietary_tag">[] = [];
    for (const tag of splitTags(text("dietary"))) {
      const key = enumKey(tag);
      const value = (DIETARY_TAGS as readonly string[]).includes(key) ? (key as Enums<"dietary_tag">) : DIETARY_SYNONYMS[key];
      if (!value) fail("dietary", `Unknown dietary tag “${tag}”. Use: vegan, vegetarian, dairy free, gluten free, nut free, contains caffeine, decaf.`);
      else if (!dietaryTags.includes(value)) dietaryTags.push(value);
    }

    const catering = yesNo(text("catering"), false);
    if (catering === null) fail("catering", `Write yes or no (not “${text("catering")}”).`);
    const active = yesNo(text("active"), true);
    if (active === null) fail("active", `Write yes or no (not “${text("active")}”).`);

    if (slug && !seenSlugs.has(slug)) seenSlugs.set(slug, rowNumber);
    if (rowErrors.length) {
      errors.push(...rowErrors);
      continue;
    }

    if (!categories.has(categorySlug)) {
      categories.set(categorySlug, categoryName);
      plan.categories.push({ slug: categorySlug, name: categoryName });
    }
    plan.products.push({
      row: rowNumber,
      slug,
      name,
      description: description || null,
      categorySlug,
      categoryName: categories.get(categorySlug)!,
      basePriceCents,
      sizes,
      groups: planGroups,
      allergens,
      dietaryTags,
      cateringEligible: catering!,
      active: active!,
    });
  }

  if (rowCount === 0 && errors.length === 0) errors.push({ row: 0, column: null, message: "The file has a header row but no items." });
  return { plan, errors, rowCount };
}

/** The plan as admin_import_menu() takes it. */
export function toImportRpcPlan(plan: ImportPlan) {
  return {
    categories: plan.categories.map((c) => ({ slug: c.slug, name: c.name })),
    products: plan.products.map((p) => ({
      slug: p.slug,
      name: p.name,
      description: p.description ?? "",
      category_slug: p.categorySlug,
      base_price_cents: p.basePriceCents,
      sizes: p.sizes.map((s) => ({ name: s.name, price_cents: s.priceCents, is_default: s.isDefault })),
      groups: p.groups.map((g) => (g.when ? { slug: g.slug, visible_when_option_id: g.when.optionId } : g.slug)),
      allergens: p.allergens,
      dietary_tags: p.dietaryTags,
      is_catering_eligible: p.cateringEligible,
      is_active: p.active,
    })),
  };
}

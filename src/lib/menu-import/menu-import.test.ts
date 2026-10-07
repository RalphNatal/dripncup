import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/csv";

import { EXAMPLE_ROWS, TEMPLATE_HEADERS } from "./format";
import { readMenuFile, templateCsvRows, templateXlsx } from "./file";
import { parseMenuRows, parsePrice, toImportRpcPlan, type KnownGroup } from "./parse";
import { previewImport, type ExistingProduct } from "./preview";
import { readXlsx, writeXlsx, type SheetCell } from "./xlsx";

const GROUPS: KnownGroup[] = [
  { id: "g-temp", slug: "temperature", name: "Hot or Iced", options: [{ id: "o-hot", name: "Hot" }, { id: "o-iced", name: "Iced" }] },
  { id: "g-ice", slug: "ice-level", name: "Ice", options: [{ id: "o-light", name: "Light ice" }, { id: "o-reg", name: "Regular ice" }] },
  { id: "g-milk", slug: "milk", name: "Milk", options: [{ id: "o-whole", name: "Whole milk" }] },
  { id: "g-shots", slug: "espresso-shots", name: "Espresso shots", options: [{ id: "o-shot", name: "Extra espresso shot" }] },
  { id: "g-syrups", slug: "syrups", name: "Flavors & syrups", options: [{ id: "o-van", name: "Vanilla" }] },
  { id: "g-sweet", slug: "sweetness", name: "Sweetness", options: [{ id: "o-100", name: "100%" }] },
  { id: "g-top", slug: "toppings", name: "Toppings", options: [{ id: "o-boba", name: "Boba pearls" }] },
];

const text = (rows: (readonly string[])[]): SheetCell[][] => rows.map((r) => r.map((t) => ({ text: t, kind: "text" as const })));
const header = [...TEMPLATE_HEADERS];
/** One row in template column order, from a partial record. */
const row = (cells: Partial<Record<string, string>>) => TEMPLATE_HEADERS.map((h) => cells[h] ?? "");

describe("parseMenuRows: the example file", () => {
  const result = parseMenuRows(text([header, ...EXAMPLE_ROWS]), GROUPS);

  it("reads every example row without errors", () => {
    expect(result.errors).toEqual([]);
    expect(result.rowCount).toBe(EXAMPLE_ROWS.length);
    expect(result.plan.products.map((p) => p.slug)).toEqual([
      "ube-latte", "hojicha-latte", "lilikoi-hibiscus-cooler", "spam-musubi", "butter-mochi", "haupia-pie-slice",
    ]);
  });

  it("collects each category once, by slug", () => {
    expect(result.plan.categories).toEqual([
      { slug: "coffee-espresso", name: "Coffee & Espresso" },
      { slug: "tropical-refreshers", name: "Tropical Refreshers" },
      { slug: "food-snacks", name: "Food & Snacks" },
      { slug: "bakery", name: "Bakery" },
    ]);
  });

  it("reads sizes with the starred default, and single prices", () => {
    const ube = result.plan.products[0];
    expect(ube.sizes).toEqual([
      { name: "Small", priceCents: 575, isDefault: false },
      { name: "Medium", priceCents: 650, isDefault: true },
      { name: "Large", priceCents: 725, isDefault: false },
    ]);
    expect(ube.basePriceCents).toBe(0);
    const musubi = result.plan.products[3];
    expect(musubi.sizes).toEqual([]);
    expect(musubi.basePriceCents).toBe(375);
  });

  it("reads modifier groups and their 'if' conditions", () => {
    expect(result.plan.products[0].groups).toEqual([
      { slug: "temperature", name: "Hot or Iced", when: null },
      { slug: "ice-level", name: "Ice", when: { optionId: "o-iced", optionName: "Iced" } },
      { slug: "milk", name: "Milk", when: null },
      { slug: "espresso-shots", name: "Espresso shots", when: null },
      { slug: "syrups", name: "Flavors & syrups", when: null },
    ]);
  });

  it("reads tags and yes/no columns", () => {
    const mochi = result.plan.products[4];
    expect(mochi.allergens).toEqual(["dairy", "egg"]);
    expect(mochi.dietaryTags).toEqual(["vegetarian", "gluten_free"]);
    expect(mochi.cateringEligible).toBe(true);
    expect(result.plan.products[5].cateringEligible).toBe(false);
    expect(mochi.active).toBe(true);
  });

  it("becomes the RPC plan, with conditions as objects and plain groups as slugs", () => {
    const rpc = toImportRpcPlan(result.plan);
    expect(rpc.products[0].groups).toEqual(["temperature", { slug: "ice-level", visible_when_option_id: "o-iced" }, "milk", "espresso-shots", "syrups"]);
    expect(rpc.products[3]).toMatchObject({ slug: "spam-musubi", base_price_cents: 375, sizes: [], category_slug: "food-snacks" });
  });
});

describe("parseMenuRows: bad prices", () => {
  const errorsFor = (cells: Partial<Record<string, string>>) =>
    parseMenuRows(text([header, row({ Category: "Food", Product: "Cookie", ...cells })]), GROUPS).errors.map((e) => e.message);

  it("refuses a $ sign, a missing cents part and one decimal", () => {
    expect(errorsFor({ Price: "$5" })).toEqual(["Write “$5” without the $ sign, like 5."]);
    expect(errorsFor({ Price: "5" })).toEqual(["Write “5” with cents, like 5.00."]);
    expect(errorsFor({ Price: "5.5" })).toEqual(["Write “5.5” with two decimals, like 5.50."]);
    expect(errorsFor({ Price: "five" })).toEqual(["“five” isn't a price. Write dollars and cents, like 5.50."]);
    expect(errorsFor({ Price: "1,200.00" })).toEqual(["Write “1,200.00” without commas, like 5.50."]);
  });

  it("refuses a missing price, and both a price and sizes", () => {
    expect(errorsFor({})).toEqual(["Missing price. Give a price, or sizes with prices."]);
    expect(errorsFor({ Price: "3.00", Sizes: "Small=3.00" })).toEqual(["Give a price or sizes, not both."]);
  });

  it("checks each size", () => {
    expect(errorsFor({ Sizes: "Small=4.5; Large 5.25" })).toEqual([
      "Small: Write “4.5” with two decimals, like 4.50.",
      "“Large 5.25” should look like Medium=5.25.",
    ]);
    expect(errorsFor({ Sizes: "Small*=4.50; Large*=5.25" })).toEqual(["Mark only one size with *."]);
  });

  it("accepts an .xlsx number cell with up to two decimals", () => {
    expect(parsePrice({ text: "5.5", kind: "number" })).toEqual({ cents: 550 });
    expect(parsePrice({ text: "5.555", kind: "number" })).toEqual({ error: "“5.555” has more than two decimals. Write it like 5.50." });
  });

  it("reports the spreadsheet row and column", () => {
    const result = parseMenuRows(
      text([header, row({ Category: "Food", Product: "Ok", Price: "1.00" }), [], row({ Category: "Food", Product: "Bad", Price: "$1" })]),
      GROUPS,
    );
    expect(result.errors).toEqual([{ row: 4, column: "Price", message: "Write “$1” without the $ sign, like 1." }]);
    expect(result.plan.products.map((p) => p.slug)).toEqual(["ok"]);
  });
});

describe("parseMenuRows: modifier groups and other columns", () => {
  const errorsFor = (cells: Partial<Record<string, string>>) =>
    parseMenuRows(text([header, row({ Category: "Drinks", Product: "Tea", Price: "3.00", ...cells })]), GROUPS).errors.map((e) => e.message);

  it("names an unknown group", () => {
    expect(errorsFor({ "Modifier groups": "milk; boba" })).toEqual([
      "Unknown modifier group “boba”. Use a short name from the Modifiers page, or create the group first.",
    ]);
  });

  it("matches groups by short name or name, ignoring case", () => {
    expect(errorsFor({ "Modifier groups": "MILK; Flavors & Syrups" })).toEqual([]);
  });

  it("checks 'if' conditions against the other listed groups", () => {
    expect(errorsFor({ "Modifier groups": "ice-level if Iced" })).toEqual([
      "ice-level if Iced: no other group on this item has an option called “Iced”.",
    ]);
  });

  it("refuses unknown allergens, dietary tags and yes/no values", () => {
    expect(errorsFor({ Allergens: "dairy, shellfish", Dietary: "keto", Catering: "maybe" })).toEqual([
      "Unknown allergen “shellfish”. Use: dairy, tree nuts, macadamia, peanuts, gluten, soy, egg, sesame.",
      "Unknown dietary tag “keto”. Use: vegan, vegetarian, dairy free, gluten free, nut free, contains caffeine, decaf.",
      "Write yes or no (not “maybe”).",
    ]);
  });

  it("refuses a repeated slug", () => {
    const result = parseMenuRows(
      text([header, row({ Category: "A", Product: "Tea", Price: "3.00" }), row({ Category: "A", Product: "Tea!", Price: "3.00" })]),
      GROUPS,
    );
    expect(result.errors).toEqual([{ row: 3, column: "Slug", message: "Row 2 already has “tea”. Each item needs its own slug." }]);
  });

  it("needs the header columns", () => {
    expect(parseMenuRows(text([["Name", "Cost"], ["Tea", "3.00"]]), GROUPS).errors[0].message).toBe(
      'The "Category" column is missing. Start from the template.',
    );
  });
});

describe("parseMenuRows: formula cells", () => {
  const errorsFor = (cells: Partial<Record<string, string>>) =>
    parseMenuRows(text([header, row({ Category: "Food", Product: "Cookie", Price: "3.00", ...cells })]), GROUPS).errors.map((e) => e.message);

  it("refuses text that a spreadsheet would run", () => {
    expect(errorsFor({ Description: "=HYPERLINK(\"http://evil\",\"click\")" })).toEqual([
      "Cells can't start with “=” (spreadsheets treat that as a formula). Remove the first character.",
    ]);
    expect(errorsFor({ Description: "@SUM(1)" })[0]).toMatch(/can't start with “@”/);
    expect(errorsFor({ Description: "+cmd" })[0]).toMatch(/can't start with “\+”/);
    expect(errorsFor({ Price: "-3.00" })[0]).toMatch(/can't start with “-”/);
  });

  it("refuses real formula cells from an .xlsx", () => {
    const rows: SheetCell[][] = [
      header.map((h) => ({ text: h, kind: "text" })),
      row({ Category: "Food", Product: "Cookie" }).map((t, i) =>
        i === TEMPLATE_HEADERS.indexOf("Price") ? { text: "3", kind: "formula" } : { text: t, kind: "text" },
      ),
    ];
    expect(parseMenuRows(rows, GROUPS).errors.map((e) => e.message)).toEqual([
      "Formulas aren't allowed. Copy the cells and paste them back as values.",
    ]);
  });
});

describe("xlsx", () => {
  it("round-trips what it writes, Hawaiian characters and numbers included", () => {
    const bytes = writeXlsx([{ name: "Menu", header: true, rows: [["Product", "Price"], ["Lilikoʻi <Cooler> & co", 5.5], ["", "3.75"]] }]);
    expect(readXlsx(bytes)).toEqual([
      [{ text: "Product", kind: "text" }, { text: "Price", kind: "text" }],
      [{ text: "Lilikoʻi <Cooler> & co", kind: "text" }, { text: "5.5", kind: "number" }],
      [{ text: "", kind: "text" }, { text: "3.75", kind: "text" }],
    ]);
  });

  it("reads the 'Menu' sheet first, else the first sheet", () => {
    const bytes = writeXlsx([
      { name: "Notes", rows: [["ignore me"]] },
      { name: "Menu", rows: [["pick me"]] },
    ]);
    expect(readXlsx(bytes)[0][0].text).toBe("pick me");
    expect(readXlsx(bytes, { prefer: "Other" })[0][0].text).toBe("ignore me");
  });

  /** A hand-made workbook the way Excel writes it: shared strings, rich text, a formula, prefixes. */
  function excelStyle(sheetXml: string, extra: Record<string, Uint8Array> = {}) {
    return zipSync({
      "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="x"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'),
      "xl/workbook.xml": strToU8('<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Sheet1" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8('<sst><si><t>Category</t></si><si><r><t>Coffee </t></r><r><t xml:space="preserve">&amp; Tea</t></r><rPh><t>ignored</t></rPh></si></sst>'),
      "xl/worksheets/sheet1.xml": strToU8(sheetXml),
      ...extra,
    });
  }

  it("reads shared strings, rich text, sparse cells and flags formulas", () => {
    const bytes = excelStyle(
      '<x:worksheet xmlns:x="m"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1"><x:f>1+1</x:f><x:v>2</x:v></x:c></x:row>' +
        '<x:row r="3"><x:c r="B3" t="s"><x:v>1</x:v></x:c><x:c r="C3" t="b"><x:v>1</x:v></x:c></x:row></x:sheetData></x:worksheet>',
    );
    expect(readXlsx(bytes)).toEqual([
      [{ text: "Category", kind: "text" }, { text: "", kind: "text" }, { text: "2", kind: "formula" }],
      [],
      [{ text: "", kind: "text" }, { text: "Coffee & Tea", kind: "text" }, { text: "TRUE", kind: "boolean" }],
    ]);
  });

  it("refuses workbooks with macros", () => {
    const bytes = excelStyle("<worksheet><sheetData/></worksheet>", { "xl/vbaProject.bin": new Uint8Array([1, 2, 3]) });
    expect(() => readXlsx(bytes)).toThrow(/macros/);
  });
});

describe("readMenuFile", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it("reads a CSV (with a byte-order mark) and an .xlsx", () => {
    const csv = readMenuFile("menu.csv", bytes(toCsv(templateCsvRows("example"))));
    const xlsx = readMenuFile("menu.xlsx", templateXlsx("example"));
    expect(csv.ok && xlsx.ok).toBe(true);
    if (csv.ok && xlsx.ok) {
      expect(csv.format).toBe("csv");
      expect(xlsx.format).toBe("xlsx");
      expect(xlsx.rows.map((r) => r.map((c) => c.text))).toEqual(csv.rows.map((r) => r.map((c) => c.text)));
      expect(parseMenuRows(xlsx.rows, GROUPS).errors).toEqual([]);
    }
  });

  it("the template's Menu sheet is just the header; its Example sheet is filled in", () => {
    const template = templateXlsx("template");
    const menu = readXlsx(template, { prefer: "Menu" });
    expect(menu.map((r) => r.map((c) => c.text))).toEqual([[...TEMPLATE_HEADERS]]);
    expect(readXlsx(template, { prefer: "Example" }).length).toBe(EXAMPLE_ROWS.length + 1);
  });

  it("refuses empty, oversized, binary, old Excel, PDF and non-UTF-8 files", () => {
    expect(readMenuFile("a.csv", new Uint8Array())).toEqual({ ok: false, message: "That file is empty." });
    expect(readMenuFile("a.csv", new Uint8Array(2 * 1024 * 1024 + 1)).ok).toBe(false);
    expect(readMenuFile("a.xls", bytes("a,b")).ok).toBe(false);
    expect(readMenuFile("a.dat", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2]))).toMatchObject({ ok: false, message: expect.stringMatching(/old-style Excel/) });
    expect(readMenuFile("a.pdf", bytes("%PDF-1.7"))).toMatchObject({ ok: false, message: expect.stringMatching(/PDF/) });
    expect(readMenuFile("a.csv", new Uint8Array([0x61, 0xff, 0xfe, 0x62]))).toMatchObject({ ok: false, message: expect.stringMatching(/UTF-8/) });
    expect(readMenuFile("a.csv", bytes("a\u0000b"))).toMatchObject({ ok: false });
    expect(readMenuFile("a.xlsx", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toMatchObject({ ok: false, message: expect.stringMatching(/readable/) });
  });
});

describe("previewImport", () => {
  const plan = parseMenuRows(
    text([
      header,
      row({ Category: "Coffee", Product: "Latte", Sizes: "Small=5.00; Medium*=6.00", "Modifier groups": "milk", Allergens: "dairy" }),
      row({ Category: "Coffee", Product: "Mocha", Sizes: "Small=5.50", "Modifier groups": "milk" }),
      row({ Category: "Food", Product: "Cookie", Price: "3.00" }),
    ]),
    GROUPS,
  ).plan;
  const existing = (over: Partial<ExistingProduct> & Pick<ExistingProduct, "slug" | "name">): ExistingProduct => ({
    description: null, categorySlug: "coffee", basePriceCents: 0, isActive: true, archived: false, cateringEligible: false,
    allergens: [], dietaryTags: [], sizes: [], groups: [], ...over,
  });
  const current = {
    categories: [{ slug: "coffee" }],
    products: [
      existing({ slug: "latte", name: "Latte", allergens: ["dairy"], groups: [{ slug: "milk", whenOptionId: null }],
        sizes: [{ name: "Small", priceCents: 500, isDefault: false }, { name: "Medium", priceCents: 575, isDefault: true }] }),
      existing({ slug: "mocha", name: "Mocha", groups: [{ slug: "milk", whenOptionId: null }], sizes: [{ name: "Small", priceCents: 550, isDefault: true }] }),
      existing({ slug: "scone", name: "Scone", categorySlug: "food", basePriceCents: 300, sizes: [] }),
    ],
  };

  it("sorts items into new, changed and unchanged, saying what changes", () => {
    const preview = previewImport(plan, current, { archiveMissing: false });
    expect(preview.newCategories).toEqual([{ slug: "food", name: "Food" }]);
    expect(preview.creates.map((i) => i.slug)).toEqual(["cookie"]);
    expect(preview.updates.map((i) => [i.slug, i.changes])).toEqual([["latte", ["Price: Medium $5.75 → $6.00"]]]);
    expect(preview.unchanged.map((i) => i.slug)).toEqual(["mocha"]);
    expect(preview.archives).toEqual([]);
  });

  it("lists what would be archived only when asked", () => {
    expect(previewImport(plan, current, { archiveMissing: true }).archives).toEqual([{ slug: "scone", name: "Scone" }]);
  });
});

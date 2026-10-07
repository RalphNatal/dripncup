/**
 * Just enough of the XLSX format to read a menu spreadsheet and to write the
 * template. Reads cell VALUES only: nothing in the file is ever evaluated or
 * run. A cell holding a formula is reported as one (the import refuses it),
 * a workbook with macros is refused outright, and the zip is bounded so a
 * "zip bomb" cannot balloon in memory.
 *
 * Works with files saved by Excel, Google Sheets, LibreOffice and Numbers:
 * shared and inline strings, rich text, namespace prefixes, sparse rows.
 */
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";

export class SpreadsheetError extends Error {}

export interface SheetCell {
  /** The value as text ("5.5" for a number cell, "TRUE" for a boolean). */
  text: string;
  kind: "text" | "number" | "boolean" | "formula" | "error";
}

/** Uncompressed size we are willing to read, across the parts we read. */
const MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_COLUMNS = 60;

// ---------------------------------------------------------------------------
// A tiny XML tokenizer (the parts used here are regular and well-formed).
// ---------------------------------------------------------------------------

type XmlEvent =
  | { type: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "close"; name: string }
  | { type: "text"; text: string };

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body] ?? whole;
  });
}

/** "x:row" -> "row". */
const localName = (name: string) => name.slice(name.indexOf(":") + 1);

function* xmlEvents(xml: string): Generator<XmlEvent> {
  const pattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const match of xml.matchAll(pattern)) {
    if (match[1] !== undefined) {
      yield { type: "text", text: match[1] };
    } else if (match[3] !== undefined) {
      const name = localName(match[3]);
      if (match[2] === "/") {
        yield { type: "close", name };
      } else {
        const attrs: Record<string, string> = {};
        for (const a of (match[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
          attrs[localName(a[1])] = decodeXml(a[2] ?? a[3] ?? "");
        }
        yield { type: "open", name, attrs, selfClosing: match[5] === "/" };
      }
    } else if (match[6] !== undefined) {
      yield { type: "text", text: decodeXml(match[6]) };
    }
  }
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  let total = 0;
  let hasMacros = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (/vbaProject\.bin$/i.test(file.name) || /\.bin$/i.test(file.name) && /^xl\/(activeX|embeddings)\//i.test(file.name)) {
          hasMacros = true;
          return false;
        }
        const wanted =
          file.name === "[Content_Types].xml" ||
          file.name === "xl/workbook.xml" ||
          file.name === "xl/_rels/workbook.xml.rels" ||
          file.name === "xl/sharedStrings.xml" ||
          /^xl\/worksheets\/[^/]+\.xml$/.test(file.name);
        if (!wanted) return false;
        // fflate inflates into a buffer of the declared size, so bounding the
        // declared sizes bounds the memory used, whatever the data claims.
        total += file.originalSize;
        if (total > MAX_UNCOMPRESSED_BYTES) throw new SpreadsheetError("That spreadsheet is too large to read.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof SpreadsheetError) throw error;
    throw new SpreadsheetError("That file isn't a readable .xlsx spreadsheet.");
  }
  if (hasMacros) throw new SpreadsheetError("Spreadsheets with macros or embedded objects aren't accepted. Save it as a plain .xlsx or .csv.");
  const types = files["[Content_Types].xml"] ? strFromU8(files["[Content_Types].xml"]) : "";
  if (/macroEnabled/i.test(types)) {
    throw new SpreadsheetError("Spreadsheets with macros aren't accepted. Save it as a plain .xlsx or .csv.");
  }
  if (!files["xl/workbook.xml"]) throw new SpreadsheetError("That file isn't a readable .xlsx spreadsheet.");
  return files;
}

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  let skip = 0; // inside <rPh> (phonetic hints): not part of the value
  for (const event of xmlEvents(xml)) {
    if (event.type === "open") {
      if (event.name === "si") current = "";
      else if (event.name === "rPh" && !event.selfClosing) skip += 1;
      else if (event.name === "t" && !event.selfClosing) inText = true;
      if (event.name === "si" && event.selfClosing) {
        strings.push("");
        current = null;
      }
    } else if (event.type === "close") {
      if (event.name === "si" && current !== null) {
        strings.push(current);
        current = null;
      } else if (event.name === "rPh") skip -= 1;
      else if (event.name === "t") inText = false;
    } else if (inText && skip === 0 && current !== null) {
      current += event.text;
    }
  }
  return strings;
}

/** "BC12" -> 54 (zero-based column). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetPath(files: Record<string, Uint8Array>, prefer: string): string {
  const workbook = strFromU8(files["xl/workbook.xml"]);
  const sheets: { name: string; rid: string }[] = [];
  for (const event of xmlEvents(workbook)) {
    if (event.type === "open" && event.name === "sheet") sheets.push({ name: event.attrs.name ?? "", rid: event.attrs.id ?? "" });
  }
  if (sheets.length === 0) throw new SpreadsheetError("That spreadsheet has no sheets.");
  const chosen = sheets.find((s) => s.name.trim().toLowerCase() === prefer.toLowerCase()) ?? sheets[0];

  const relsXml = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  for (const event of xmlEvents(relsXml)) {
    if (event.type === "open" && event.name === "Relationship" && event.attrs.Id === chosen.rid) {
      const target = event.attrs.Target ?? "";
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      if (files[path]) return path;
    }
  }
  // Fall back to the conventional name.
  if (files["xl/worksheets/sheet1.xml"]) return "xl/worksheets/sheet1.xml";
  throw new SpreadsheetError("Couldn't find the sheet's cells in that spreadsheet.");
}

/**
 * The rows of one sheet (the one named `prefer`, else the first). Rows and
 * cells are positioned as in the sheet; gaps are empty text cells.
 */
export function readXlsx(bytes: Uint8Array, { prefer = "Menu" }: { prefer?: string } = {}): SheetCell[][] {
  const files = unzip(bytes);
  const strings = sharedStrings(files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : null);
  const xml = strFromU8(files[sheetPath(files, prefer)]);

  const rows: SheetCell[][] = [];
  let rowIndex = -1;
  let row: SheetCell[] | null = null;
  let cell: { col: number; type: string; value: string; formula: boolean; inline: string; inValue: boolean; inInline: boolean } | null = null;
  let nextCol = 0;

  for (const event of xmlEvents(xml)) {
    if (event.type === "open") {
      if (event.name === "row") {
        const r = Number(event.attrs.r);
        rowIndex = Number.isInteger(r) && r > 0 ? r - 1 : rowIndex + 1;
        if (rowIndex >= MAX_ROWS) throw new SpreadsheetError(`That spreadsheet has more than ${MAX_ROWS} rows.`);
        row = [];
        nextCol = 0;
        if (event.selfClosing) {
          rows[rowIndex] = row;
          row = null;
        }
      } else if (event.name === "c" && row) {
        const col = event.attrs.r ? columnIndex(event.attrs.r) : nextCol;
        nextCol = col + 1;
        if (col >= MAX_COLUMNS) {
          cell = null;
          continue;
        }
        cell = { col, type: event.attrs.t ?? "n", value: "", formula: false, inline: "", inValue: false, inInline: false };
        if (event.selfClosing) {
          row[col] = { text: "", kind: "text" };
          cell = null;
        }
      } else if (cell) {
        if (event.name === "f") cell.formula = true;
        else if (event.name === "v" && !event.selfClosing) cell.inValue = true;
        else if (event.name === "t" && !event.selfClosing && cell.type === "inlineStr") cell.inInline = true;
      }
    } else if (event.type === "close") {
      if (event.name === "v" && cell) cell.inValue = false;
      else if (event.name === "t" && cell) cell.inInline = false;
      else if (event.name === "c" && cell && row) {
        row[cell.col] = toCell(cell, strings);
        cell = null;
      } else if (event.name === "row" && row) {
        rows[rowIndex] = row;
        row = null;
      }
    } else if (cell) {
      if (cell.inValue) cell.value += event.text;
      else if (cell.inInline) cell.inline += event.text;
    }
  }

  return Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? { text: "", kind: "text" as const }));
}

function toCell(cell: { type: string; value: string; formula: boolean; inline: string }, strings: string[]): SheetCell {
  if (cell.formula) return { text: cell.type === "s" ? (strings[Number(cell.value)] ?? "") : cell.value, kind: "formula" };
  switch (cell.type) {
    case "s":
      return { text: strings[Number(cell.value)] ?? "", kind: "text" };
    case "inlineStr":
      return { text: cell.inline, kind: "text" };
    case "str":
      return { text: cell.value, kind: "text" };
    case "b":
      return { text: cell.value === "1" ? "TRUE" : "FALSE", kind: "boolean" };
    case "e":
      return { text: cell.value, kind: "error" };
    default:
      return { text: cell.value, kind: cell.value === "" ? "text" : "number" };
  }
}

// ---------------------------------------------------------------------------
// Writing (the template). Inline strings; header row bold and frozen;
// columns marked `text` are formatted as Text, so a price typed as 5.50
// stays "5.50" instead of becoming the number 5.5.
// ---------------------------------------------------------------------------

export interface WriteSheet {
  name: string;
  rows: (string | number)[][];
  columns?: { width: number; text?: boolean }[];
  /** Bold and freeze the first row. */
  header?: boolean;
}

const escapeXml = (text: string) =>
  text.replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[ch]!)
    // Characters XML 1.0 cannot hold.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function sheetXml(sheet: WriteSheet): string {
  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"${c.text ? ' style="2"' : ""}/>`)
        .join("")}</cols>`
    : "";
  const view = sheet.header
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const style = sheet.header && r === 0 ? ' s="1"' : sheet.columns?.[c]?.text ? ' s="2"' : "";
          if (typeof value === "number") return `<c r="${ref}"${style}><v>${value}</v></c>`;
          if (value === "") return "";
          return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${view}${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: readonly WriteSheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    // Styles: 0 default, 1 bold (header), 2 text format (@).
    "xl/styles.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
  };
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet));
  });
  return zipSync(files, { level: 6 });
}

/**
 * An uploaded menu file -> spreadsheet rows. Decides the format from the
 * file's bytes (never the name or the type the browser claims), with limits:
 *
 *   - at most 2 MB, and not empty
 *   - .xlsx (a zip with a workbook in it) or UTF-8 text (.csv)
 *   - old .xls, macro-enabled workbooks, PDFs and other binaries refused
 *
 * Nothing in the file is executed: CSV is split into text, and the XLSX
 * reader only reads cell values (./xlsx.ts).
 */
import { CsvError, parseCsv } from "@/lib/csv";

import { TEMPLATE_HEADERS, EXAMPLE_ROWS, TEMPLATE_HELP_ROWS, IMPORT_COLUMNS } from "./format";
import { SpreadsheetError, readXlsx, writeXlsx, type SheetCell } from "./xlsx";

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type MenuFile = { ok: true; format: "csv" | "xlsx"; rows: SheetCell[][] } | { ok: false; message: string };

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);

export function readMenuFile(name: string, bytes: Uint8Array): MenuFile {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > IMPORT_MAX_BYTES) return { ok: false, message: "That file is over 2 MB. Menu spreadsheets are much smaller; check it's the right file." };
  if (/\.xl(s|sm|sb|tm|am)$/i.test(name)) {
    return { ok: false, message: "Save the spreadsheet as .xlsx (Excel Workbook) or .csv, then upload that." };
  }

  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    try {
      return { ok: true, format: "xlsx", rows: readXlsx(bytes, { prefer: "Menu" }) };
    } catch (error) {
      return { ok: false, message: error instanceof SpreadsheetError ? error.message : "That file isn't a readable .xlsx spreadsheet." };
    }
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    return { ok: false, message: "That's an old-style Excel file. Save it as .xlsx (Excel Workbook) or .csv, then upload that." };
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { ok: false, message: "That's a PDF. Upload the spreadsheet (.xlsx or .csv)." };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, message: "That file isn't UTF-8 text. In Excel, use File › Save As › CSV UTF-8, or upload the .xlsx." };
  }
  if (text.includes("\u0000")) return { ok: false, message: "That isn't a spreadsheet. Upload a .csv or .xlsx file." };
  try {
    return { ok: true, format: "csv", rows: parseCsv(text).map((row) => row.map((cell) => ({ text: cell, kind: "text" as const }))) };
  } catch (error) {
    return { ok: false, message: error instanceof CsvError ? `That CSV can't be read: ${error.message}` : "That CSV can't be read." };
  }
}

// ---------------------------------------------------------------------------
// Downloads: the empty template and the filled-in example.
// ---------------------------------------------------------------------------

export type TemplateKind = "template" | "example";

export function templateCsvRows(kind: TemplateKind): string[][] {
  return [[...TEMPLATE_HEADERS], ...(kind === "example" ? EXAMPLE_ROWS.map((r) => [...r]) : [])];
}

export function templateXlsx(kind: TemplateKind): Uint8Array {
  const columns = IMPORT_COLUMNS.map((c) => ({ width: c.width, text: c.text }));
  const menu = { name: "Menu", header: true, columns, rows: templateCsvRows(kind) };
  const help = {
    name: "How to fill",
    header: true,
    columns: [{ width: 18 }, { width: 10 }, { width: 90 }, { width: 50 }],
    rows: TEMPLATE_HELP_ROWS.map((r) => [...r]),
  };
  const sheets = kind === "template"
    ? [menu, { name: "Example", header: true, columns, rows: templateCsvRows("example") }, help]
    : [menu, help];
  return writeXlsx(sheets);
}

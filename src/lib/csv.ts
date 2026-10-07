/**
 * CSV in and out.
 *
 * Writing: every export the admin downloads goes through `toCsv`, which is
 * safe to open in Excel, Numbers or Google Sheets:
 *   - a text cell starting with =, +, -, @, a tab or a carriage return is
 *     prefixed with an apostrophe, so a spreadsheet shows it as text instead
 *     of running it as a formula (OWASP "CSV injection")
 *   - numbers the app computed are written as plain numbers (they are never
 *     escaped, so a refund column stays numeric)
 *   - UTF-8 with a byte-order mark, so Excel shows ʻokina and kahakō
 *     properly; CRLF line endings
 *
 * Reading: RFC 4180 -- quoted fields, doubled quotes, commas and line
 * breaks inside quotes, CRLF or LF, a leading byte-order mark.
 */

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

/** One text cell, made safe and quoted as needed. */
export function csvText(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function cell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return csvText(value);
}

export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Cents as a plain dollars number for a spreadsheet: 1234 -> 12.34. */
export function csvDollars(cents: number | null | undefined): number | null {
  return cents === null || cents === undefined ? null : Math.round(cents) / 100;
}

export class CsvError extends Error {}

/** Rows of cells, as written (no trimming). Throws CsvError on an unterminated quote. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (quoted) throw new CsvError("A quoted cell is never closed.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

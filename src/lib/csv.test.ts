import { describe, expect, it } from "vitest";

import { CsvError, csvDollars, csvText, parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("defuses cells a spreadsheet would run as a formula", () => {
    expect(csvText("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvText("+1+1")).toBe("'+1+1");
    expect(csvText("-2+3")).toBe("'-2+3");
    expect(csvText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvText("\tcmd")).toBe("'\tcmd");
    expect(csvText("Latte")).toBe("Latte");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvText('Say "aloha", friend')).toBe('"Say ""aloha"", friend"');
    expect(csvText("two\nlines")).toBe('"two\nlines"');
  });

  it("writes numbers as numbers, even negative ones", () => {
    expect(toCsv([["Refund", -5.25, 0, null]])).toBe("﻿Refund,-5.25,0,\r\n");
  });

  it("starts with a byte-order mark and keeps Hawaiian characters", () => {
    const text = toCsv([["Lilikoʻi", "Kakaʻako", "Hōkū"]]);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Lilikoʻi,Kakaʻako,Hōkū");
  });

  it("formats cents as dollars", () => {
    expect(csvDollars(1234)).toBe(12.34);
    expect(csvDollars(5)).toBe(0.05);
    expect(csvDollars(null)).toBeNull();
  });
});

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and embedded line breaks", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n"line\none",2\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["line\none", "2"],
    ]);
  });

  it("drops a byte-order mark and handles a missing final newline", () => {
    expect(parseCsv("﻿Category,Product\nTea,Matcha")).toEqual([
      ["Category", "Product"],
      ["Tea", "Matcha"],
    ]);
  });

  it("keeps empty cells", () => {
    expect(parseCsv("a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("refuses an unterminated quote", () => {
    expect(() => parseCsv('a,"b\n')).toThrow(CsvError);
  });

  it("round-trips what toCsv writes", () => {
    const rows = [["Name", "Note"], ["Lilikoʻi Cooler", 'big, "cold"']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

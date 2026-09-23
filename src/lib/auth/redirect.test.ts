import { describe, expect, it } from "vitest";

import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps same-origin paths, including query and hash", () => {
    expect(safeNextPath("/account")).toBe("/account");
    expect(safeNextPath("/orders/abc?tab=receipt#top")).toBe("/orders/abc?tab=receipt#top");
  });

  it("falls back for missing or non-string values", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath(["/account"])).toBe("/");
    expect(safeNextPath(null, "/account")).toBe("/account");
  });

  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "\\\\evil.test",
    "javascript:alert(1)",
    "/\t/evil.test",
    "/\n/evil.test",
    "account",
  ])("refuses %j", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});

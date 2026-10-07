import { describe, expect, it } from "vitest";

import { checkAccentColor, contrastRatio, formatRatio, normalizeHexColor } from "./contrast";

describe("accent colour contrast", () => {
  it("normalises #RRGGBB and refuses anything else", () => {
    expect(normalizeHexColor("e0409b")).toBe("#E0409B");
    expect(normalizeHexColor(" #0e7c86 ")).toBe("#0E7C86");
    expect(normalizeHexColor("#fff")).toBeNull();
    expect(normalizeHexColor("red; background: url(x)")).toBeNull();
  });

  it("matches the brand's documented ratios against white", () => {
    // Decisions Log, Phase 1 (rounded there): bright teal ~2.5:1, magenta 3.9:1, the deep variants 4.95:1 and 6.1:1.
    expect(formatRatio(contrastRatio("#1AB3C0", "#FFFFFF"))).toBe("2.54:1");
    expect(formatRatio(contrastRatio("#E0409B", "#FFFFFF"))).toBe("3.90:1");
    expect(contrastRatio("#0E7C86", "#FFFFFF")).toBeCloseTo(4.95, 1);
    expect(contrastRatio("#B81C74", "#FFFFFF")).toBeGreaterThan(6);
  });

  it("warns when a colour fails AA for text, passes when it does not", () => {
    expect(checkAccentColor("#1AB3C0")).toMatchObject({ passesForText: false, passesForLargeText: false });
    expect(checkAccentColor("#E0409B")).toMatchObject({ passesForText: false, passesForLargeText: true });
    expect(checkAccentColor("#0E7C86")).toMatchObject({ passesForText: true });
  });

  it("is 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });
});

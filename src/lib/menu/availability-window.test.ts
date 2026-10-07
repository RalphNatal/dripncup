import { describe, expect, it } from "vitest";

import { isLimitedTime, isProductAvailableAt, outOfWindowMessage } from "./availability-window";

const window = { available_from: "2026-10-01T00:00:00-10:00", available_until: "2026-11-01T00:00:00-10:00" };

describe("product availability windows", () => {
  it("is always available without a window", () => {
    expect(isProductAvailableAt({ available_from: null, available_until: null }, new Date("2020-01-01"))).toBe(true);
    expect(isLimitedTime({ available_from: null, available_until: null })).toBe(false);
  });

  it("appears at the start, to the millisecond", () => {
    expect(isProductAvailableAt(window, new Date(Date.parse(window.available_from) - 1))).toBe(false);
    expect(isProductAvailableAt(window, new Date(window.available_from))).toBe(true);
  });

  it("disappears at the end", () => {
    expect(isProductAvailableAt(window, new Date(Date.parse(window.available_until) - 1))).toBe(true);
    expect(isProductAvailableAt(window, new Date(window.available_until))).toBe(false);
  });

  it("handles an open start or end", () => {
    expect(isProductAvailableAt({ available_from: null, available_until: window.available_until }, new Date("2020-01-01"))).toBe(true);
    expect(isProductAvailableAt({ available_from: window.available_from, available_until: null }, new Date("2030-01-01"))).toBe(true);
    expect(isLimitedTime({ available_from: null, available_until: window.available_until })).toBe(true);
  });

  it("says whether it is coming or gone", () => {
    expect(outOfWindowMessage(window, new Date("2026-09-01"))).toMatch(/isn't on the menu yet/);
    expect(outOfWindowMessage(window, new Date("2026-12-01"))).toMatch(/no longer on the menu/);
  });
});

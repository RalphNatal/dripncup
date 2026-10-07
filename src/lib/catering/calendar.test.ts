import { describe, expect, it } from "vitest";

import { addDaysToKey, monthGrid, rangeOf, shiftMonth, weekKeys } from "./calendar";

describe("catering calendar grids", () => {
  it("lays out a month in whole Sunday-to-Saturday weeks", () => {
    // October 2026 starts on a Thursday and ends on a Saturday.
    const grid = monthGrid("2026-10-18");
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toBe("2026-09-27");
    expect(grid[0][4]).toBe("2026-10-01");
    expect(grid.at(-1)!.at(-1)).toBe("2026-10-31");
    expect(grid.every((week) => week.length === 7)).toBe(true);
  });

  it("covers a six-week month", () => {
    // May 2026 starts on a Friday and has 31 days.
    expect(monthGrid("2026-05-01")).toHaveLength(6);
  });

  it("gives the week containing a day", () => {
    expect(weekKeys("2026-10-21")).toEqual([
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
    ]);
  });

  it("moves between months and across years", () => {
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("queries from Honolulu midnight to the next one", () => {
    const { from, to } = rangeOf(weekKeys("2026-10-21"));
    expect(from.toISOString()).toBe("2026-10-18T10:00:00.000Z");
    expect(to.toISOString()).toBe("2026-10-25T10:00:00.000Z");
  });
});

import { describe, expect, it } from "vitest";

import { hoursProblem } from "./hours-rules";

describe("hoursProblem", () => {
  it("accepts split days, touching ranges and a midnight close", () => {
    expect(
      hoursProblem([
        { dayOfWeek: 1, opensAt: "07:00", closesAt: "11:00" },
        { dayOfWeek: 1, opensAt: "11:00", closesAt: "14:00" },
        { dayOfWeek: 1, opensAt: "17:00", closesAt: "24:00" },
      ]),
    ).toEqual({});
  });

  it("refuses overlaps and backwards ranges, per day", () => {
    expect(
      hoursProblem([
        { dayOfWeek: 2, opensAt: "07:00", closesAt: "12:00" },
        { dayOfWeek: 2, opensAt: "11:00", closesAt: "14:00" },
        { dayOfWeek: 3, opensAt: "18:00", closesAt: "07:00" },
      ]),
    ).toEqual({ "day.2": "Two ranges overlap.", "day.3": "Each range must close after it opens (use “midnight” for 12 AM)." });
  });

  it("needs real times", () => {
    expect(hoursProblem([{ dayOfWeek: 0, opensAt: "", closesAt: "18:00" }])).toEqual({ "day.0": "Pick an opening and a closing time." });
  });
});

import { describe, expect, it } from "vitest";

import { eventPhase, eventSlug, eventWindowProblem, shiftEventToDate, slugify } from "./window";

const event = { startsAt: "2026-10-18T10:00:00-10:00", endsAt: "2026-10-18T15:00:00-10:00" };

describe("event windows", () => {
  it("is upcoming, then live from the start, then past from the end", () => {
    expect(eventPhase(event, new Date("2026-10-18T09:59:59-10:00"))).toBe("upcoming");
    expect(eventPhase(event, new Date("2026-10-18T10:00:00-10:00"))).toBe("live");
    expect(eventPhase(event, new Date("2026-10-18T14:59:59-10:00"))).toBe("live");
    expect(eventPhase(event, new Date("2026-10-18T15:00:00-10:00"))).toBe("past");
  });

  it("needs an end after the start", () => {
    const start = new Date(event.startsAt);
    expect(eventWindowProblem(start, start)).toBe("end_before_start");
    expect(eventWindowProblem(start, new Date(start.getTime() - 1))).toBe("end_before_start");
    expect(eventWindowProblem(null, start)).toBe("missing");
    expect(eventWindowProblem(start, new Date(event.endsAt))).toBeNull();
  });

  it("keeps one row per day: at most 24 hours, so a night market across midnight is fine", () => {
    const start = new Date("2026-10-18T17:00:00-10:00");
    expect(eventWindowProblem(start, new Date("2026-10-19T01:00:00-10:00"))).toBeNull();
    expect(eventWindowProblem(start, new Date("2026-10-19T17:00:00-10:00"))).toBeNull();
    expect(eventWindowProblem(start, new Date("2026-10-19T17:00:01-10:00"))).toBe("too_long");
  });
});

describe("duplicating to another date", () => {
  it("keeps the Honolulu wall-clock times and the length", () => {
    const copy = shiftEventToDate({ startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) }, "2026-10-25");
    expect(copy.startsAt.toISOString()).toBe(new Date("2026-10-25T10:00:00-10:00").toISOString());
    expect(copy.endsAt.toISOString()).toBe(new Date("2026-10-25T15:00:00-10:00").toISOString());
  });

  it("carries a night market across midnight", () => {
    const night = { startsAt: new Date("2026-10-18T18:30:00-10:00"), endsAt: new Date("2026-10-19T00:30:00-10:00") };
    const copy = shiftEventToDate(night, "2026-11-01");
    expect(copy.startsAt.toISOString()).toBe(new Date("2026-11-01T18:30:00-10:00").toISOString());
    expect(copy.endsAt.toISOString()).toBe(new Date("2026-11-02T00:30:00-10:00").toISOString());
  });

  it("can go to an earlier date too", () => {
    const copy = shiftEventToDate({ startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) }, "2026-10-04");
    expect(copy.startsAt.toISOString()).toBe(new Date("2026-10-04T10:00:00-10:00").toISOString());
  });

  it("gives the copy a slug for its date", () => {
    expect(eventSlug("kakaako-market-2026-10-18", "2026-10-25")).toBe("kakaako-market-2026-10-25");
    expect(eventSlug("Kakaʻako Farmers Market", "2026-10-25")).toBe("kakaako-farmers-market-2026-10-25");
    expect(eventSlug("kakaako-market-2026-10-18-2", "2026-10-25")).toBe("kakaako-market-2026-10-25");
  });

  it("slugifies Hawaiian names without the ʻokina or kahakō", () => {
    expect(slugify("Hāleʻiwa Night Market!")).toBe("haleiwa-night-market");
  });
});

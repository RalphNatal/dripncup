import { describe, expect, it } from "vitest";

import {
  checkDeliveryArea,
  defaultQuoteExpiry,
  earliestEventAt,
  isInsideLeadTime,
  normalizeZip,
  paymentDeadline,
  quotePayability,
} from "./rules";

const HOUR = 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

describe("lead time", () => {
  const now = at("2026-10-06T09:07:00-10:00");

  it("offers the first quarter hour at least 72 hours away", () => {
    expect(earliestEventAt(now, 72).toISOString()).toBe(at("2026-10-09T09:15:00-10:00").toISOString());
    expect(earliestEventAt(at("2026-10-06T09:15:00-10:00"), 72).toISOString()).toBe(at("2026-10-09T09:15:00-10:00").toISOString());
  });

  it("blocks anything sooner than the lead time, to the millisecond", () => {
    const edge = new Date(now.getTime() + 72 * HOUR);
    expect(isInsideLeadTime(new Date(edge.getTime() - 1), now, 72)).toBe(true);
    expect(isInsideLeadTime(edge, now, 72)).toBe(false);
    expect(isInsideLeadTime(at("2026-10-07T12:00:00-10:00"), now, 72)).toBe(true);
  });

  it("follows the setting", () => {
    expect(isInsideLeadTime(at("2026-10-08T09:08:00-10:00"), now, 48)).toBe(false);
    expect(isInsideLeadTime(at("2026-10-08T09:08:00-10:00"), now, 72)).toBe(true);
  });
});

describe("payment deadline and quote expiry", () => {
  const event = at("2026-10-20T11:00:00-10:00");
  const settings = { paymentDeadlineHours: 48, quoteValidDays: 7 };

  it("is 48 hours before the event", () => {
    expect(paymentDeadline(event, 48).toISOString()).toBe(at("2026-10-18T11:00:00-10:00").toISOString());
  });

  it("expires a quote after 7 days by default", () => {
    const issued = at("2026-10-06T10:00:00-10:00");
    expect(defaultQuoteExpiry(issued, event, settings)?.toISOString()).toBe(at("2026-10-13T10:00:00-10:00").toISOString());
  });

  it("never lets a quote outlive the payment deadline", () => {
    const issued = at("2026-10-15T10:00:00-10:00");
    expect(defaultQuoteExpiry(issued, event, settings)?.toISOString()).toBe(at("2026-10-18T11:00:00-10:00").toISOString());
  });

  it("cannot issue a quote once the deadline has passed", () => {
    expect(defaultQuoteExpiry(at("2026-10-18T11:00:00-10:00"), event, settings)).toBeNull();
  });
});

describe("quotePayability", () => {
  const quote = {
    id: "q2",
    status: "active",
    expiresAt: at("2026-10-13T10:00:00-10:00"),
    paymentDeadlineAt: at("2026-10-18T11:00:00-10:00"),
  };
  const ok = { requestStatus: "quoted", quote, currentQuoteId: "q2", now: at("2026-10-10T10:00:00-10:00") };

  it("is payable while quoted, current, unexpired and before the deadline", () => {
    expect(quotePayability(ok)).toEqual({ payable: true });
  });

  it("refuses a request that is not waiting for payment", () => {
    expect(quotePayability({ ...ok, requestStatus: "confirmed" })).toMatchObject({ payable: false, reason: "not_quoted" });
  });

  it("refuses a quote that has been replaced", () => {
    expect(quotePayability({ ...ok, currentQuoteId: "q3" })).toMatchObject({ reason: "not_current" });
    expect(quotePayability({ ...ok, quote: { ...quote, status: "superseded" } })).toMatchObject({ reason: "not_current" });
  });

  it("refuses an expired quote", () => {
    expect(quotePayability({ ...ok, now: quote.expiresAt })).toMatchObject({ reason: "expired" });
  });

  it("refuses after the payment deadline, whatever the expiry says", () => {
    const late = { ...quote, expiresAt: quote.paymentDeadlineAt };
    expect(quotePayability({ ...ok, quote: late, now: quote.paymentDeadlineAt })).toMatchObject({ reason: "past_deadline" });
  });
});

describe("delivery area", () => {
  const settings = { deliveryOffered: true, zipCodes: ["96814", "96734"] };

  it("normalises ZIP+4 and trims", () => {
    expect(normalizeZip(" 96814-1234 ")).toBe("96814");
    expect(normalizeZip("9681")).toBeNull();
    expect(normalizeZip("HI 96814")).toBeNull();
  });

  it("accepts a listed ZIP", () => {
    expect(checkDeliveryArea("96734", settings)).toEqual({ ok: true, zip: "96734" });
  });

  it("explains an address outside the area", () => {
    const result = checkDeliveryArea("96720", settings);
    expect(result).toMatchObject({ ok: false, reason: "outside_area" });
    expect(!result.ok && result.message).toContain("96720");
  });

  it("asks for a real ZIP", () => {
    expect(checkDeliveryArea("abc", settings)).toMatchObject({ ok: false, reason: "invalid_zip" });
  });

  it("refuses delivery when it is switched off", () => {
    expect(checkDeliveryArea("96814", { ...settings, deliveryOffered: false })).toMatchObject({ reason: "not_offered" });
  });
});

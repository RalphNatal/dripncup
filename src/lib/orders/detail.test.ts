import { describe, expect, it } from "vitest";

import { retryDelayMinutes } from "@/lib/email/retry";

import { describeSnapshotModifier, itemSummary, paymentMethodLabel } from "./detail";
import { decodeOrdersCursor, encodeOrdersCursor } from "./list";

describe("itemSummary", () => {
  it("names the first item and counts the rest by quantity", () => {
    expect(itemSummary([{ name: "Latte", quantity: 1 }])).toBe("Latte");
    expect(itemSummary([{ name: "Latte", quantity: 2 }])).toBe("2 × Latte");
    expect(
      itemSummary([
        { name: "Latte", quantity: 1 },
        { name: "Cookie", quantity: 1 },
        { name: "Mochi", quantity: 1 },
      ]),
    ).toBe("Latte + 2 more");
    expect(
      itemSummary([
        { name: "Latte", quantity: 2 },
        { name: "Cookie", quantity: 3 },
      ]),
    ).toBe("2 × Latte + 3 more");
    expect(itemSummary([])).toBe("No items");
  });
});

describe("paymentMethodLabel", () => {
  it("shows brand and last four, with any wallet", () => {
    expect(paymentMethodLabel({ brand: "visa", last4: "4242", wallet: null })).toBe("Visa •••• 4242");
    expect(paymentMethodLabel({ brand: "amex", last4: "0005", wallet: "apple_pay" })).toBe("Apple Pay · American Express •••• 0005");
    expect(paymentMethodLabel({ brand: null, last4: null, wallet: "link" })).toBe("Link");
    expect(paymentMethodLabel(null)).toBeNull();
  });
});

describe("describeSnapshotModifier", () => {
  it("reads the order_items snapshot the way the cart describes a line", () => {
    expect(describeSnapshotModifier({ option_name: "Vanilla", quantity: 2, quantity_unit: "pump" })).toBe("Vanilla (2 pumps)");
    expect(describeSnapshotModifier({ option_name: "Oat milk", quantity: 1 })).toBe("Oat milk");
  });
});

describe("order history cursor", () => {
  it("round-trips and rejects anything malformed", () => {
    const item = { createdAt: "2026-10-03T19:00:00.123456+00:00", id: "8e9d1c56-55a4-4d9e-9a63-3a6c1b3a2f10" };
    expect(decodeOrdersCursor(encodeOrdersCursor(item))).toEqual(item);
    expect(decodeOrdersCursor("not-a-date|8e9d1c56-55a4-4d9e-9a63-3a6c1b3a2f10")).toBeNull();
    expect(decodeOrdersCursor("2026-10-03T19:00:00Z|' or 1=1")).toBeNull();
    expect(decodeOrdersCursor(null)).toBeNull();
  });
});

describe("email retry backoff", () => {
  it("waits longer after each failure, capped at four hours", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryDelayMinutes)).toEqual([1, 5, 15, 60, 240, 240, 240]);
  });
});

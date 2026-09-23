import { describe, expect, it } from "vitest";

import { directionsUrls, isAppleMobile } from "./directions";

describe("directions links", () => {
  it("encodes the destination for both map apps", () => {
    const urls = directionsUrls("1221 Kapiolani Blvd, Honolulu, HI 96814");
    expect(urls.google).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1221%20Kapiolani%20Blvd%2C%20Honolulu%2C%20HI%2096814",
    );
    expect(urls.apple).toBe("https://maps.apple.com/?daddr=1221%20Kapiolani%20Blvd%2C%20Honolulu%2C%20HI%2096814");
  });

  it("recognises iPhone and iPad, including iPadOS posing as a Mac", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
    const ipadOs = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36";

    expect(isAppleMobile(iphone)).toBe(true);
    expect(isAppleMobile(ipadOs, 5)).toBe(true);
    expect(isAppleMobile(ipadOs, 0)).toBe(false);
    expect(isAppleMobile(android, 5)).toBe(false);
  });
});

/**
 * `npm run stripe:listen` forwards exactly the events the webhook handles,
 * and the README's command lists the same. If src/lib/payments/stripe.ts
 * learns a new event, scripts/lib/stripe-events.mjs must learn it too.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { STRIPE_WEBHOOK_EVENTS } from "../scripts/lib/stripe-events.mjs";

describe("Stripe webhook events", () => {
  it("are the events verifyWebhook handles", () => {
    const source = readFileSync("src/lib/payments/stripe.ts", "utf8");
    const body = source.slice(source.indexOf("async verifyWebhook"));
    const handled = [...body.matchAll(/case "([a-z_.]+)":/g)].map((m) => m[1]);
    expect([...handled].sort()).toEqual([...STRIPE_WEBHOOK_EVENTS].sort());
  });

  it("are listed in the README", () => {
    const readme = readFileSync("README.md", "utf8");
    for (const event of STRIPE_WEBHOOK_EVENTS) expect(readme).toContain(event);
  });
});

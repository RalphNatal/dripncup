import "server-only";

import { stripeProvider } from "./stripe";
import type { PaymentProvider } from "./types";

/** The active payment provider. One place to change if the cafe's POS needs another. */
export function paymentProvider(): PaymentProvider {
  return stripeProvider;
}

export type * from "./types";
export { WebhookSignatureError } from "./types";

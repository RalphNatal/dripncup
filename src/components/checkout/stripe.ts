"use client";

/**
 * Stripe.js, loaded once per publishable key, and the Elements styling that
 * makes the card form look like the rest of the app.
 */
import { loadStripe, type Appearance, type CssFontSource, type Stripe } from "@stripe/stripe-js";

const loaded = new Map<string, Promise<Stripe | null>>();

export function getStripe(publishableKey: string): Promise<Stripe | null> {
  let promise = loaded.get(publishableKey);
  if (!promise) {
    promise = loadStripe(publishableKey);
    loaded.set(publishableKey, promise);
  }
  return promise;
}

export const stripeFonts: CssFontSource[] = [
  { cssSrc: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
];

export const stripeAppearance: Appearance = {
  theme: "stripe",
  variables: {
    colorPrimary: "#0e7c86",
    colorText: "#101114",
    colorTextSecondary: "#5d5a56",
    colorDanger: "#c0332f",
    colorBackground: "#ffffff",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSizeBase: "16px",
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { borderColor: "#e7e2dc", boxShadow: "none", padding: "12px" },
    ".Input:focus": { borderColor: "#0e7c86", boxShadow: "0 0 0 3px rgba(14, 124, 134, 0.25)" },
    ".Tab": { borderColor: "#e7e2dc", boxShadow: "none" },
    ".Tab--selected": { borderColor: "#0e7c86", boxShadow: "0 0 0 1px #0e7c86" },
  },
};

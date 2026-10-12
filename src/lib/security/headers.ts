/**
 * Security headers: the Content Security Policy (per request, with a nonce)
 * and the static headers every response carries. Pure, so the exact policy
 * is unit-tested; src/proxy.ts sets the CSP on each page and next.config.ts
 * sets the rest.
 *
 * What the CSP allows, and why (ARCHITECTURE.md, "Security headers"):
 *   scripts   our own, only with this request's nonce ('strict-dynamic' lets
 *             them load their chunks and Stripe.js); never inline handlers
 *             or eval (eval only in `next dev`, which React needs)
 *   styles    our own plus inline: the server HTML carries style="" attributes
 *             (React style props) that a nonce cannot cover, and styles
 *             cannot run code
 *   connect   our origin, Supabase (REST, Auth, Realtime websocket), Stripe's API
 *   frames    Stripe only (the card form, wallets and 3-D Secure challenges)
 *   images    our origin, Supabase Storage, data:/blob: (generated previews)
 *   nobody may frame us (frame-ancestors 'none'); no plugins, no <base>,
 *   forms post only to us
 */

/** Stripe.js and its frames (Payment Element, Express Checkout, 3-D Secure). */
export const STRIPE_SCRIPT_SOURCES = ["https://js.stripe.com", "https://*.js.stripe.com"] as const;
export const STRIPE_FRAME_SOURCES = ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"] as const;
export const STRIPE_CONNECT_SOURCES = ["https://api.stripe.com", "https://merchant-ui-api.stripe.com", "https://r.stripe.com"] as const;
export const STRIPE_IMAGE_SOURCES = ["https://*.stripe.com"] as const;

export interface CspOptions {
  nonce: string;
  /** `next dev`: React needs eval for its error overlays. */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl: string;
  /** NEXT_PUBLIC_SITE_URL: https sites also upgrade stray http requests. */
  siteUrl: string;
}

/** "https://x.supabase.co" → ["https://x.supabase.co", "wss://x.supabase.co"]. */
function supabaseSources(supabaseUrl: string): { http: string; ws: string } {
  const url = new URL(supabaseUrl);
  return { http: url.origin, ws: `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}` };
}

export function buildCsp({ nonce, dev, supabaseUrl, siteUrl }: CspOptions): string {
  const supabase = supabaseSources(supabaseUrl);
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // Browsers that understand 'strict-dynamic' ignore 'self' and the hosts
    // here; they are the fallback for older ones.
    ["script-src", ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...STRIPE_SCRIPT_SOURCES, ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", supabase.http, ...STRIPE_IMAGE_SOURCES]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", supabase.http, supabase.ws, ...STRIPE_CONNECT_SOURCES]],
    ["frame-src", [...STRIPE_FRAME_SOURCES]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["media-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (siteUrl.startsWith("https://")) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** A fresh nonce: 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Browser features this app may use; everything listed with () is switched
 * off for us and for every frame. Notifications and vibration are not
 * controlled by Permissions-Policy (there is no such feature), so they need
 * no entry. Only features Chromium recognises are listed: an unknown name is
 * logged as a console error on every page.
 */
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  // The staff dashboard's "Go fullscreen".
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  // Apple Pay and Google Pay run inside Stripe's frame.
  `payment=(self "https://js.stripe.com")`,
  "picture-in-picture=()",
  `publickey-credentials-get=(self "https://js.stripe.com")`,
  // The staff dashboard keeps the counter tablet's screen on.
  "screen-wake-lock=(self)",
  "serial=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

export interface StaticHeaderOptions {
  /** Production builds only: HSTS is pinned by browsers for two years. */
  production: boolean;
}

/** Headers for every response (next.config.ts `headers()`). */
export function staticSecurityHeaders({ production }: StaticHeaderOptions): Array<{ key: string; value: string }> {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // frame-ancestors 'none' in the CSP is the modern form; this covers old browsers.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    // Our windows don't share a browsing context group with other sites'
    // (Spectre isolation); popups we open (wallets, 3-D Secure) still work.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
  if (production) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  return headers;
}

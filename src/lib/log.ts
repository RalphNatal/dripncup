/**
 * Server error logging: one JSON line per error, with enough context to find
 * the cause and nothing that identifies a customer.
 *
 *   {"level":"error","event":"checkout.create_failed","requestId":"…",
 *    "viewer":"signed-in","route":"/checkout","error":{"name":"…","message":"…"},…}
 *
 * - requestId: set by src/proxy.ts on every page request and returned to the
 *   browser as X-Request-Id, so a customer's report can be matched to a line
 * - viewer: "guest", "signed-in", "customer", "staff" or "admin"; never an
 *   id, name or email
 * - messages, stacks and context strings pass through redact(): emails,
 *   phone numbers, card-like numbers, bearer tokens and API keys are masked
 *   (a Postgres error can quote the row it failed on)
 *
 * Unhandled errors from pages, Server Actions and route handlers reach
 * onRequestError in src/instrumentation.ts, which writes the same shape.
 * Customers and staff only ever see a friendly message (and, for page
 * errors, the digest Next shows in the error boundary).
 */
import { REQUEST_ID_HEADER, VIEWER_HEADER } from "@/lib/request-headers";

type ContextValue = string | number | boolean | null | undefined;

const PATTERNS: Array<[RegExp, string]> = [
  // JWTs (Supabase access tokens) and bearer credentials.
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]"],
  [/\b(?:Bearer|Basic)\s+[\w.~+/=-]+/gi, "[credentials]"],
  // Stripe and Supabase keys, webhook secrets, client secrets.
  [/\b(?:sk|rk|pk|whsec|sb_secret|sb_publishable)_[\w]+/g, "[key]"],
  [/\bpi_[\w]+_secret_[\w]+/g, "[client-secret]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  // Card-like numbers (13-19 digits, optionally spaced) before phone numbers.
  [/\b(?:\d[ -]?){12,18}\d\b/g, "[number]"],
  // US phone numbers written with separators, or ten bare digits; never part
  // of a longer token (an order number like DC-261012-0042 is not one).
  [/(?<![\w-])(?:\+?1[ .-]?)?(?:\(\d{3}\) ?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\w-])/g, "[phone]"],
  [/(?<![\w-])\d{10}(?![\w-])/g, "[phone]"],
];

/** Masks personal data and secrets in free text. */
export function redact(text: string): string {
  return PATTERNS.reduce((out, [pattern, mask]) => out.replace(pattern, mask), text);
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    const extra = error as Error & { digest?: unknown; code?: unknown };
    return {
      name: error.name,
      message: redact(error.message).slice(0, 1000),
      ...(typeof extra.digest === "string" ? { digest: extra.digest } : {}),
      ...(typeof extra.code === "string" ? { code: extra.code } : {}),
      stack: error.stack ? redact(error.stack).split("\n").slice(1, 8).join("\n") : undefined,
    };
  }
  if (error && typeof error === "object") {
    // Supabase/PostgREST errors are plain objects: { message, code, details, hint }.
    const plain = error as { message?: unknown; code?: unknown };
    return {
      name: "Error",
      message: redact(String(plain.message ?? JSON.stringify(error))).slice(0, 1000),
      ...(typeof plain.code === "string" ? { code: plain.code } : {}),
    };
  }
  return { name: "Error", message: redact(String(error)).slice(0, 1000) };
}

export interface LogLine {
  event: string;
  error: unknown;
  requestId?: string | null;
  viewer?: string | null;
  route?: string | null;
  context?: Record<string, ContextValue>;
}

/** The JSON written for one error. Exported for tests. */
export function formatErrorLog({ event, error, requestId, viewer, route, context = {} }: LogLine): string {
  const safeContext = Object.fromEntries(
    Object.entries(context)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === "string" ? redact(value).slice(0, 300) : value]),
  );
  return JSON.stringify({
    level: "error",
    time: new Date().toISOString(),
    event,
    requestId: requestId ?? null,
    viewer: viewer ?? null,
    route: route ?? null,
    ...safeContext,
    error: describeError(error),
  });
}

/** Writes one error line now. For callers that already know the request. */
export function writeErrorLog(line: LogLine) {
  console.error(formatErrorLog(line));
}

/** The request id and viewer of the request being handled, when there is one. */
async function currentRequest(): Promise<{ requestId: string | null; viewer: string | null }> {
  try {
    const { headers } = await import("next/headers");
    const incoming = await headers();
    return { requestId: incoming.get(REQUEST_ID_HEADER), viewer: incoming.get(VIEWER_HEADER) };
  } catch {
    // Outside a request (a cron sweep, after(), a script): no request context.
    return { requestId: null, viewer: null };
  }
}

/**
 * Logs a server error with the current request's id and viewer. Never
 * throws; the line may be written a moment after the call.
 */
export function logError(event: string, error: unknown, context?: Record<string, ContextValue>) {
  void currentRequest().then(
    ({ requestId, viewer }) => writeErrorLog({ event, error, requestId, viewer, context }),
    () => writeErrorLog({ event, error, context }),
  );
}

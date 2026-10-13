import type { Instrumentation } from "next";

/**
 * Runs once when a Next.js server starts.
 *
 * Decides local test mode (TEST_STORE_ALWAYS_OPEN) up front, so a flag the
 * guard refuses is reported in the server log at start, production included.
 * In development it also starts the outbox sweep (emails and push
 * notifications; see src/lib/email/dev-sweep.ts). Nothing happens on the edge.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { storeAlwaysOpen } = await import("./lib/test-mode");
  if (storeAlwaysOpen()) console.info("Test mode: TEST_STORE_ALWAYS_OPEN is on. Store hours and closures are ignored.");

  if (process.env.NODE_ENV !== "development") return;
  const { startDevOutboxSweep } = await import("./lib/email/dev-sweep");
  startDevOutboxSweep();
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | null {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Every error a page, Server Action, route handler or the proxy did not
 * handle: one JSON line with the request id, route and viewer role, nothing
 * personal (src/lib/log.ts). The browser only ever sees Next's generic
 * message and a digest, which this line carries too.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { isClientDisconnect, writeErrorLog } = await import("./lib/log");
  if (isClientDisconnect(error)) return;
  const { REQUEST_ID_HEADER, VIEWER_HEADER } = await import("./lib/request-headers");
  writeErrorLog({
    event: `unhandled.${context.routeType}`,
    error,
    requestId: header(request.headers, REQUEST_ID_HEADER),
    viewer: header(request.headers, VIEWER_HEADER),
    route: context.routePath,
    context: {
      method: request.method,
      // The query string can carry search terms (names, emails); only the path is kept.
      path: request.path.split("?")[0],
      renderSource: "renderSource" in context ? context.renderSource : undefined,
    },
  });
};

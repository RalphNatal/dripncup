/**
 * Request headers src/proxy.ts sets for the page render. A client can never
 * supply its own: the proxy overwrites each one on every request.
 */

/** This request's CSP nonce; Next also reads it from the policy itself. */
export const NONCE_HEADER = "x-nonce";
/** A random id per request, returned to the browser as X-Request-Id and written in error logs. */
export const REQUEST_ID_HEADER = "x-request-id";
/** "guest", "signed-in", or the role when the route needed it. Never who the user is. */
export const VIEWER_HEADER = "x-dc-viewer";

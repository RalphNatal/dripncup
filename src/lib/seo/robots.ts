/**
 * Paths search engines are asked not to crawl (/robots.txt): the admin, the
 * counter screen, anyone's account, orders, cart or checkout (signed-in
 * pages with nothing for search), catering payment, the API, sign-in and the
 * offline page. The sitemap never lists them.
 */
export const DISALLOWED_PATHS = [
  "/admin",
  "/staff",
  "/account",
  "/orders",
  "/checkout",
  "/cart",
  "/catering/",
  "/api/",
  "/auth/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/offline",
  "/serwist/",
] as const;

/** Whether robots.txt keeps crawlers off `path` (prefix rules, as crawlers read them). */
export function isDisallowed(path: string): boolean {
  return DISALLOWED_PATHS.some((rule) => path.startsWith(rule));
}

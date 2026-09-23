/**
 * Sanitises the `?next=` return path used after sign-in and email links.
 *
 * Only same-origin paths get through. Anything else -- `https://evil.test`,
 * protocol-relative `//evil.test`, the backslash variant browsers normalise
 * to `//`, or a `javascript:` URL -- falls back, so a crafted sign-in link
 * cannot bounce a customer to a lookalike site after they enter a password.
 */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Control characters (tab, newline) are stripped by URL parsers and can be
  // used to smuggle a second slash past the checks above.
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;

  // Final check: resolving against a dummy origin must not change the origin.
  try {
    const url = new URL(value, "http://drincup.invalid");
    if (url.origin !== "http://drincup.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

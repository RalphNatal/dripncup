/**
 * Which push endpoints we will send to, and how a device is named. Pure.
 *
 * A subscription's endpoint is a URL our server POSTs to. It comes from the
 * browser, so it is checked against the push services browsers actually
 * use; anything else (a customer pointing it at an internal address) is
 * refused when saved and again before every send.
 */

/** Hosts of the push services in current browsers. */
export const PUSH_SERVICE_HOSTS: readonly RegExp[] = [
  // Chrome, Android, Samsung Internet, Opera, Brave
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  // Firefox
  /^(?:[a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  // Safari on macOS, iPhone and iPad (installed apps)
  /^(?:[a-z0-9-]+\.)*push\.apple\.com$/,
  // Edge on Windows
  /^(?:[a-z0-9-]+\.)*notify\.windows\.com$/,
];

/**
 * True for an https URL on a known push service, or one of `extraOrigins`
 * (the e2e suite's stand-in push service; never set in production).
 */
export function isAllowedPushEndpoint(endpoint: string, extraOrigins: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (endpoint.length > 2048 || url.username || url.password) return false;
  if (extraOrigins.includes(url.origin)) return true;
  return url.protocol === "https:" && (url.port === "" || url.port === "443") && PUSH_SERVICE_HOSTS.some((host) => host.test(url.hostname));
}

/** "Chrome on Android", "Safari on iPhone": enough to tell devices apart, nothing more. */
export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const platform = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /CriOS\/|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? "This device";
}

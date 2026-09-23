/**
 * "Get Directions" links. Apple Maps on iPhone and iPad, where it is the
 * default and opens straight into the app; Google Maps everywhere else.
 */
export function directionsUrls(destination: string): { google: string; apple: string } {
  const query = encodeURIComponent(destination);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${query}`,
    apple: `https://maps.apple.com/?daddr=${query}`,
  };
}

/**
 * iPhone, iPod, or iPad. iPadOS 13+ reports a desktop Mac user agent, so a
 * "Macintosh" with a touch screen counts too.
 */
export function isAppleMobile(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

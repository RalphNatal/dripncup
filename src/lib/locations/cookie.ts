/**
 * The selected pickup location lives in a cookie, not in client state, so
 * Server Components render the right menu, sold-out flags and status on the
 * very first byte. It holds only a location id -- nothing personal.
 */
export const LOCATION_COOKIE = "dc_location";

/** Remembered for 90 days; a stale id simply falls back to the cafe. */
export const LOCATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

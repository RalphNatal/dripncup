/**
 * Brand and business constants for Drincup Cafe.
 *
 * Single source of truth for anything that appears in copy, metadata or
 * structured data. Values still awaiting confirmation from the owner are
 * marked NEEDS_CONFIRMATION so they are easy to grep before launch.
 */

/** Marks a value that is a stand-in until the owner confirms it. */
export const NEEDS_CONFIRMATION = true;

export const BRAND = {
  name: "Drincup Cafe",
  /** The logo renders the wordmark in lowercase. */
  wordmark: "drincup cafe",
  shortName: "Drincup",
  taglines: {
    primary: "Sip, Smile, Repeat.",
    secondary: "Good drinks, food, & community.",
  },
  /**
   * The name is inspired by Psalm 23:5-6 and Psalm 34:8 -- tasting that God is
   * good, and a cup that overflows.
   *
   * NEEDS_CONFIRMATION: replace with the approved About copy from the current
   * site. This placeholder is intentionally short so it is obvious if it ships.
   */
  storyPlaceholder:
    "Drincup Cafe is named for a cup that overflows. Psalm 34:8 invites us to taste and see that the Lord is good, and Psalm 23 speaks of a table prepared and a cup running over. That is the spirit we pour into every drink: generous, warm, and made for sharing.",
  loyaltyProgramName: "Overflow Rewards",
} as const;

export const CAFE_ADDRESS = {
  line1: "1221 Kapiolani Blvd",
  line2: "Site 112A",
  city: "Honolulu",
  state: "HI",
  postalCode: "96814",
  country: "US",
} as const;

/** Single-line address for map deep links and structured data. */
export const CAFE_ADDRESS_ONE_LINE = `${CAFE_ADDRESS.line1}, ${CAFE_ADDRESS.line2}, ${CAFE_ADDRESS.city}, ${CAFE_ADDRESS.state} ${CAFE_ADDRESS.postalCode}`;

/**
 * NEEDS_CONFIRMATION: every field below. Left as null rather than invented so
 * the UI can hide the element instead of rendering a wrong phone number.
 */
export const CONTACT: {
  phone: string | null;
  email: string | null;
  instagram: string | null;
  facebook: string | null;
} = {
  phone: null,
  email: null,
  instagram: null,
  facebook: null,
};

/** Hawaii has no daylight saving; this never shifts. */
export const CAFE_TIMEZONE = "Pacific/Honolulu";

export const CURRENCY = "USD";
export const LOCALE = "en-US";

/**
 * Fallbacks used only if the `settings` table cannot be read. The database is
 * the real source of truth -- these keep the app rendering rather than
 * crashing during an outage.
 */
export const SETTING_FALLBACKS = {
  /** NEEDS_CONFIRMATION: Oahu visible pass-on rate. Confirm what the cafe charges. */
  getRate: 0.04712,
  tipPresets: [0, 15, 18, 20],
  defaultTipPreset: 18,
  cateringMinLeadTimeHours: 72,
  pointsPerDollar: 2,
  schedulingSlotMinutes: 15,
  maxSchedulingDaysAhead: 7,
} as const;

/** Bottom tab bar order, per the design direction. */
export const CUSTOMER_TABS = [
  { href: "/", label: "Home" },
  { href: "/menu", label: "Menu" },
  { href: "/rewards", label: "Rewards" },
  { href: "/orders", label: "Orders" },
  { href: "/account", label: "Account" },
] as const;

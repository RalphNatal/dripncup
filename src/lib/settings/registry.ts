/**
 * The settings registry: every business setting the admin can change, with
 * its label, help text, type, limits, default, section and whether the owner
 * still has to confirm it.
 *
 * Pure (no I/O), so the settings screen, the server action and the unit
 * tests all use the same rules. The database enforces the same type and
 * limits per key (settings.value_type / min_value / max_value, set in
 * 20260101000026_admin_foundation.sql); registry.test.ts checks the two
 * agree. Who may read a setting (guests, staff, admins) is the row's
 * `is_public` flag and the staff.* rule, unchanged by this file.
 *
 * Values are stored as JSON exactly as the app reads them: money in integer
 * cents, the GET rate as a fraction (0.04712), percentages of a subtotal as
 * whole numbers (15 = 15%), times as whole minutes / hours / days.
 */
import { formatCents } from "@/lib/money";

export const SETTING_SECTIONS = [
  { id: "taxes", title: "Taxes & tips", description: "What checkout adds on top of the menu prices." },
  { id: "pickup", title: "Pickup & queue", description: "How pickup times are worked out and when customers can order." },
  { id: "checkout", title: "Checkout", description: "Unpaid checkouts." },
  { id: "staff", title: "Staff", description: "The counter screen and its printers." },
  { id: "catering", title: "Catering", description: "Lead times, payment, delivery and reminders." },
  { id: "rewards", title: "Rewards", description: "How Overflow Rewards earns and spends. Tiers are on the Rewards page." },
  { id: "notifications", title: "Notifications", description: "Emails and alerts." },
] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number]["id"];

interface Base {
  key: string;
  label: string;
  help: string;
  section: SettingSection;
  /** Shown on the setup checklist until the owner confirms it. */
  needsConfirmation: boolean;
}

/** Integer cents, shown and entered as dollars. */
export interface MoneySetting extends Base {
  type: "money";
  min: number;
  max: number;
  default: number;
}

/**
 * A percentage. `fraction` stores 4.712% as 0.04712 (the GET rate);
 * `whole` stores 15% as 15. min / max / default are in percent.
 */
export interface PercentSetting extends Base {
  type: "percent";
  storage: "fraction" | "whole";
  min: number;
  max: number;
  decimals: number;
  default: number;
}

/** A whole (or, with decimals, fractional) number with a unit. */
export interface NumberSetting extends Base {
  type: "minutes" | "hours" | "days" | "seconds" | "number";
  /** For `number`: what one is ("points", "mm", "orders"). */
  unit?: string;
  min: number;
  max: number;
  /** 0 = whole numbers only. */
  decimals: number;
  default: number;
  /** A sentence for the value 0 when it means something special ("no limit"). */
  zeroMeans?: string;
}

export interface BooleanSetting extends Base {
  type: "boolean";
  default: boolean;
  onLabel: string;
  offLabel: string;
}

export interface EmailSetting extends Base {
  type: "email";
  required: boolean;
  default: string;
}

export interface TextSetting extends Base {
  type: "text";
  minLength: number;
  maxLength: number;
  multiline: boolean;
  default: string;
}

export interface ListSetting extends Base {
  type: "list";
  item: "percent" | "zip";
  /** Percent items: the range of each. */
  min?: number;
  max?: number;
  maxItems: number;
  default: (number | string)[];
}

export type SettingDefinition =
  | MoneySetting
  | PercentSetting
  | NumberSetting
  | BooleanSetting
  | EmailSetting
  | TextSetting
  | ListSetting;

const OAHU_ZIPS = [
  "96701", "96706", "96707", "96709", "96712", "96717", "96730", "96731", "96734", "96744", "96759", "96762", "96782",
  "96786", "96789", "96791", "96792", "96795", "96797", "96813", "96814", "96815", "96816", "96817", "96818", "96819",
  "96821", "96822", "96825", "96826", "96853", "96857", "96858", "96859", "96860", "96861", "96863",
];

export const SETTINGS: readonly SettingDefinition[] = [
  // ---- Taxes & tips ---------------------------------------------------------
  {
    key: "tax.get_rate", section: "taxes", type: "percent", storage: "fraction", decimals: 3, min: 0, max: 20, default: 4.712,
    label: "Hawaii GET rate", needsConfirmation: true,
    help: "General Excise Tax added to the order after discounts, shown as \"Tax (GET)\". 4.712% is the Oʻahu pass-on rate. Past orders keep the rate they were charged.",
  },
  {
    key: "tax.tips_taxed", section: "taxes", type: "boolean", default: false, onLabel: "GET is charged on tips", offLabel: "Tips are not taxed",
    label: "Tax on tips", needsConfirmation: true,
    help: "Whether GET is charged on a tip as well as on the order.",
  },
  {
    key: "tip.presets", section: "taxes", type: "list", item: "percent", min: 0, max: 100, maxItems: 6, default: [0, 15, 18, 20],
    label: "Tip choices at checkout", needsConfirmation: true,
    help: "Percentages of the order after discounts, before tax. 0 shows as \"No tip\". A custom amount is always offered too.",
  },
  {
    key: "tip.default_preset", section: "taxes", type: "percent", storage: "whole", decimals: 0, min: 0, max: 100, default: 18,
    label: "Preselected tip", needsConfirmation: true,
    help: "The tip choice selected when checkout opens. Must be one of the tip choices.",
  },
  {
    key: "tip.custom_max_cents", section: "taxes", type: "money", min: 0, max: 100_000, default: 10_000,
    label: "Largest custom tip", needsConfirmation: true,
    help: "Catches typos. A custom tip can't be more than this, or more than the percentage below.",
  },
  {
    key: "tip.custom_max_percent", section: "taxes", type: "percent", storage: "whole", decimals: 0, min: 0, max: 200, default: 100,
    label: "Largest custom tip, as a share of the order", needsConfirmation: false,
    help: "A custom tip can't be more than this percentage of the order subtotal.",
  },
  // ---- Pickup & queue -------------------------------------------------------
  {
    key: "orders.accepting_online_orders", section: "pickup", type: "boolean", default: true,
    onLabel: "Online ordering is on", offLabel: "Online ordering is off everywhere",
    label: "Online ordering (all locations)", needsConfirmation: false,
    help: "The master switch. Off stops new online orders at every location until switched back on. For a short pause at one counter, use Pause on the Locations page.",
  },
  {
    key: "orders.queue_minutes_per_order", section: "pickup", type: "minutes", min: 0, max: 30, decimals: 0, default: 2,
    label: "Extra minutes per order in the queue", needsConfirmation: true,
    help: "ASAP estimate = prep time + this many minutes for each order already waiting, rounded up to 5 minutes.",
  },
  {
    key: "orders.max_orders_per_slot", section: "pickup", type: "number", unit: "orders", min: 0, max: 100, decimals: 0, default: 8,
    zeroMeans: "No limit",
    label: "Most orders per pickup slot", needsConfirmation: true,
    help: "Scheduled orders allowed in one pickup slot; a full slot is shown as unavailable.",
  },
  {
    key: "orders.scheduling_slot_minutes", section: "pickup", type: "minutes", min: 5, max: 60, decimals: 0, default: 15,
    label: "Pickup slot length", needsConfirmation: false,
    help: "Scheduled pickups are offered in slots of this length.",
  },
  {
    key: "orders.last_slot_buffer_minutes", section: "pickup", type: "minutes", min: 0, max: 120, decimals: 0, default: 15,
    label: "Last slot before closing", needsConfirmation: true,
    help: "The last scheduled pickup starts at least this long before closing.",
  },
  {
    key: "orders.order_ahead_while_closed", section: "pickup", type: "boolean", default: false,
    onLabel: "Customers can order ahead while closed", offLabel: "The menu is closed while the cafe is closed",
    label: "Order ahead while closed", needsConfirmation: true,
    help: "On: while a location is closed (not paused), customers can still add to their cart and schedule a pickup for when it next opens.",
  },
  {
    key: "store.pickup_instructions", section: "pickup", type: "text", minLength: 0, maxLength: 300, multiline: true,
    default: "Head to the pickup shelf at the end of the counter -- your name will be on the cup.",
    label: "Default pickup instructions", needsConfirmation: true,
    help: "Shown after ordering when a location has no instructions of its own (the cafe's are on the Locations page).",
  },
  // ---- Checkout -------------------------------------------------------------
  {
    key: "orders.pending_expiry_minutes", section: "checkout", type: "minutes", min: 10, max: 240, decimals: 0, default: 30,
    label: "Unpaid checkouts expire after", needsConfirmation: true,
    help: "A checkout not paid within this time is cancelled, and any reward points it held come back.",
  },
  // ---- Staff ----------------------------------------------------------------
  {
    key: "staff.ticket_warning_minutes", section: "staff", type: "minutes", min: 1, max: 60, decimals: 0, default: 5,
    label: "Ticket turns amber after", needsConfirmation: true,
    help: "Minutes past its estimated ready time.",
  },
  {
    key: "staff.ticket_late_minutes", section: "staff", type: "minutes", min: 1, max: 120, decimals: 0, default: 10,
    label: "Ticket turns red after", needsConfirmation: true,
    help: "Minutes past its estimated ready time. Must be later than amber.",
  },
  {
    key: "staff.receipt_width_mm", section: "staff", type: "number", unit: "mm", min: 40, max: 120, decimals: 0, default: 80,
    label: "Receipt paper width", needsConfirmation: true,
    help: "The counter receipt printer's paper width, for printed tickets.",
  },
  {
    key: "staff.label_width_mm", section: "staff", type: "number", unit: "mm", min: 20, max: 150, decimals: 0, default: 57,
    label: "Cup label width", needsConfirmation: true,
    help: "One label is printed per drink.",
  },
  {
    key: "staff.label_height_mm", section: "staff", type: "number", unit: "mm", min: 15, max: 150, decimals: 0, default: 32,
    label: "Cup label height", needsConfirmation: true,
    help: "Match the label stock in the label printer.",
  },
  // ---- Catering -------------------------------------------------------------
  {
    key: "catering.min_lead_time_hours", section: "catering", type: "hours", min: 1, max: 720, decimals: 0, default: 72,
    label: "Minimum notice", needsConfirmation: true,
    help: "A catering request must be at least this far ahead. The date picker and the database both enforce it.",
  },
  {
    key: "catering.payment_deadline_hours", section: "catering", type: "hours", min: 0, max: 336, decimals: 0, default: 48,
    label: "Pay at least this long before the event", needsConfirmation: true,
    help: "A quote can't be paid closer to the event than this.",
  },
  {
    key: "catering.quote_valid_days", section: "catering", type: "days", min: 1, max: 60, decimals: 0, default: 7,
    label: "Quotes can be paid for", needsConfirmation: true,
    help: "How long a new quote stays payable (never past the payment deadline).",
  },
  {
    key: "catering.delivery_offered", section: "catering", type: "boolean", default: true,
    onLabel: "Delivery is offered", offLabel: "Pickup only",
    label: "Catering delivery", needsConfirmation: true,
    help: "Whether customers can ask for delivery.",
  },
  {
    key: "catering.delivery_zip_codes", section: "catering", type: "list", item: "zip", maxItems: 500, default: OAHU_ZIPS,
    label: "Delivery ZIP codes", needsConfirmation: true,
    help: "Where catering delivers. Default: Oʻahu street-delivery ZIP codes.",
  },
  {
    key: "catering.delivery_fee_cents", section: "catering", type: "money", min: 0, max: 100_000, default: 2500,
    label: "Default delivery fee", needsConfirmation: true,
    help: "Filled in on new quotes for delivery; each quote can change it.",
  },
  {
    key: "catering.delivery_fee_taxable", section: "catering", type: "boolean", default: true,
    onLabel: "GET is charged on delivery", offLabel: "Delivery is not taxed",
    label: "Tax on the delivery fee", needsConfirmation: true,
    help: "Whether GET applies to the catering delivery fee.",
  },
  {
    key: "catering.gratuity_taxable", section: "catering", type: "boolean", default: false,
    onLabel: "GET is charged on gratuity", offLabel: "Gratuity is not taxed",
    label: "Tax on catering gratuity", needsConfirmation: true,
    help: "Whether GET applies to a gratuity added to a catering quote.",
  },
  {
    key: "catering.admin_notification_email", section: "catering", type: "email", required: true, default: "catering@drincup.test",
    label: "Catering inbox email", needsConfirmation: true,
    help: "New requests, change requests, payments and cancellation requests are announced here.",
  },
  {
    key: "catering.reminder_enabled", section: "catering", type: "boolean", default: true,
    onLabel: "Customers get a reminder", offLabel: "No reminder",
    label: "Event reminder email", needsConfirmation: false,
    help: "Email the customer before a confirmed catering event.",
  },
  {
    key: "catering.reminder_hours_before", section: "catering", type: "hours", min: 1, max: 168, decimals: 0, default: 24,
    label: "Send the reminder", needsConfirmation: false,
    help: "Hours before the event.",
  },
  // ---- Rewards --------------------------------------------------------------
  {
    key: "loyalty.program_name", section: "rewards", type: "text", minLength: 2, maxLength: 40, multiline: false, default: "Overflow Rewards",
    label: "Programme name", needsConfirmation: true,
    help: "What customers see on the Rewards page and their account.",
  },
  {
    key: "loyalty.points_per_dollar", section: "rewards", type: "number", unit: "points per $1", min: 0, max: 100, decimals: 2, default: 1,
    label: "Earn rate", needsConfirmation: true,
    help: "Points per dollar of the order after discounts (tax and tip excluded), rounded down, credited at pickup.",
  },
  {
    key: "loyalty.max_rewards_per_order", section: "rewards", type: "number", unit: "rewards", min: 1, max: 5, decimals: 0, default: 1,
    label: "Rewards per order", needsConfirmation: true,
    help: "How many rewards one order may use.",
  },
  {
    key: "loyalty.allow_promo_with_reward", section: "rewards", type: "boolean", default: false,
    onLabel: "A promo code and a reward can be used together", offLabel: "One discount per order: a promo code or a reward",
    label: "Promo codes with rewards", needsConfirmation: true,
    help: "Whether an order can use a promo code and a reward at once.",
  },
  {
    key: "loyalty.catering_earns_points", section: "rewards", type: "boolean", default: false,
    onLabel: "Catering earns points", offLabel: "Catering earns no points",
    label: "Points on catering", needsConfirmation: true,
    help: "Whether paid catering orders earn points.",
  },
  {
    key: "loyalty.points_expire_after_months", section: "rewards", type: "number", unit: "months", min: 0, max: 60, decimals: 0, default: 0,
    zeroMeans: "Points never expire",
    label: "Points expire after", needsConfirmation: true,
    help: "Points older than this expire, oldest first, when the daily expiry job runs. 0 = never.",
  },
  // ---- Notifications --------------------------------------------------------
  {
    key: "notifications.reply_to_email", section: "notifications", type: "email", required: false, default: "",
    label: "Replies to customer emails go to", needsConfirmation: true,
    help: "Receipts and catering emails set this as Reply-To, so a customer's reply reaches the cafe. Empty = the sending address.",
  },
  {
    key: "staff.new_order_repeat_seconds", section: "notifications", type: "seconds", min: 5, max: 300, decimals: 0, default: 15,
    label: "Repeat the new-order chime every", needsConfirmation: false,
    help: "The staff screen chimes again until someone opens, acknowledges or accepts the order.",
  },
];

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(SETTINGS.map((s) => [s.key, s]));

export function settingDefinition(key: string): SettingDefinition | null {
  return SETTINGS_BY_KEY.get(key) ?? null;
}

export function settingsInSection(section: SettingSection): SettingDefinition[] {
  return SETTINGS.filter((s) => s.section === section);
}

/** The database's view of a definition: settings.value_type, min_value, max_value. */
export function storageRule(def: SettingDefinition): { valueType: string; min: number | null; max: number | null } {
  switch (def.type) {
    case "money":
      return { valueType: "integer", min: def.min, max: def.max };
    case "percent":
      return def.storage === "fraction"
        ? { valueType: "number", min: def.min / 100, max: def.max / 100 }
        : { valueType: def.decimals === 0 ? "integer" : "number", min: def.min, max: def.max };
    case "minutes":
    case "hours":
    case "days":
    case "seconds":
    case "number":
      return { valueType: def.decimals === 0 ? "integer" : "number", min: def.min, max: def.max };
    case "boolean":
      return { valueType: "boolean", min: null, max: null };
    case "email":
      return { valueType: "email", min: def.required ? 1 : 0, max: 254 };
    case "text":
      return { valueType: "text", min: def.minLength, max: def.maxLength };
    case "list":
      return def.item === "zip"
        ? { valueType: "zip_list", min: null, max: null }
        : { valueType: "number_list", min: def.min ?? null, max: def.max ?? null };
  }
}

// ---------------------------------------------------------------------------
// Input -> stored value, with friendly messages.
// ---------------------------------------------------------------------------

export type SettingParse = { ok: true; value: unknown } | { ok: false; message: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;

function decimalsOf(text: string): number {
  return text.includes(".") ? text.split(".")[1].length : 0;
}

function parseNumber(raw: string, decimals: number): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  if (decimalsOf(text) > decimals) return null;
  return Number(text);
}

function rangeMessage(min: number, max: number, unit: string): string {
  return `Enter a number from ${min} to ${max}${unit ? ` ${unit}` : ""}.`;
}

function unitWord(def: NumberSetting): string {
  return def.type === "number" ? (def.unit ?? "") : def.type;
}

/**
 * Turns what the form sent (text, a checkbox, list text) into the JSON value
 * the database stores, or says what is wrong.
 */
export function parseSettingInput(def: SettingDefinition, raw: string | boolean): SettingParse {
  switch (def.type) {
    case "boolean":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "on") return { ok: true, value: true };
      if (raw === "false" || raw === "off" || raw === "") return { ok: true, value: false };
      return { ok: false, message: "Choose on or off." };
    case "money": {
      const text = String(raw).trim().replace(/^\$/, "").replace(/,/g, "");
      if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, message: "Enter dollars and cents, like 25.00." };
      const cents = Math.round(Number(text) * 100);
      if (cents < def.min || cents > def.max) {
        return { ok: false, message: `Enter an amount from ${formatCents(def.min)} to ${formatCents(def.max)}.` };
      }
      return { ok: true, value: cents };
    }
    case "percent": {
      const value = parseNumber(String(raw).replace(/%$/, ""), def.decimals);
      if (value === null) {
        return { ok: false, message: def.decimals ? `Enter a percentage with up to ${def.decimals} decimals, like 4.712.` : "Enter a whole percentage, like 15." };
      }
      if (value < def.min || value > def.max) return { ok: false, message: `Enter a percentage from ${def.min}% to ${def.max}%.` };
      // Fractions are rounded to the stored precision so 4.712 is 0.04712, not 0.047119999.
      return { ok: true, value: def.storage === "fraction" ? Number((value / 100).toFixed(def.decimals + 2)) : value };
    }
    case "minutes":
    case "hours":
    case "days":
    case "seconds":
    case "number": {
      const value = parseNumber(String(raw), def.decimals);
      if (value === null) {
        return { ok: false, message: def.decimals ? `Enter a number with up to ${def.decimals} decimals.` : "Enter a whole number." };
      }
      if (value < def.min || value > def.max) return { ok: false, message: rangeMessage(def.min, def.max, unitWord(def)) };
      return { ok: true, value };
    }
    case "email": {
      const text = String(raw).trim();
      if (!text) return def.required ? { ok: false, message: "Enter an email address." } : { ok: true, value: "" };
      if (!EMAIL.test(text) || text.length > 254) return { ok: false, message: "Enter a valid email address, like catering@drincupcafe.com." };
      return { ok: true, value: text };
    }
    case "text": {
      const text = String(raw).trim();
      if (text.length < def.minLength || text.length > def.maxLength) {
        return {
          ok: false,
          message: def.minLength > 0 ? `Use ${def.minLength} to ${def.maxLength} characters.` : `Keep it to ${def.maxLength} characters.`,
        };
      }
      return { ok: true, value: text };
    }
    case "list": {
      const items = String(raw)
        .split(/[\s,;]+/)
        .map((s) => s.trim().replace(/%$/, ""))
        .filter(Boolean);
      if (def.item === "zip") {
        const bad = items.find((z) => !/^\d{5}$/.test(z));
        if (bad) return { ok: false, message: `“${bad}” isn't a 5-digit ZIP code.` };
        const unique = [...new Set(items)];
        if (unique.length > def.maxItems) return { ok: false, message: `Up to ${def.maxItems} ZIP codes.` };
        return { ok: true, value: unique };
      }
      if (items.length === 0) return { ok: false, message: "Give at least one choice." };
      const numbers: number[] = [];
      for (const item of items) {
        const value = parseNumber(item, 0);
        if (value === null || value < (def.min ?? 0) || value > (def.max ?? 100)) {
          return { ok: false, message: `“${item}” isn't a whole percentage from ${def.min ?? 0} to ${def.max ?? 100}.` };
        }
        numbers.push(value);
      }
      if (new Set(numbers).size !== numbers.length) return { ok: false, message: "Each choice can appear once." };
      if (numbers.length > def.maxItems) return { ok: false, message: `Up to ${def.maxItems} choices.` };
      return { ok: true, value: numbers.sort((a, b) => a - b) };
    }
  }
}

/** Checks a stored JSON value against its definition (for values read back from the database). */
export function isValidStoredValue(def: SettingDefinition, value: unknown): boolean {
  const rule = storageRule(def);
  switch (rule.valueType) {
    case "boolean":
      return typeof value === "boolean";
    case "integer":
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        (rule.valueType === "number" || Number.isInteger(value)) &&
        (rule.min === null || value >= rule.min) &&
        (rule.max === null || value <= rule.max)
      );
    case "text":
    case "email":
      return typeof value === "string" && value.length >= (rule.min ?? 0) && value.length <= (rule.max ?? 10000);
    case "number_list":
      return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number");
    case "zip_list":
      return Array.isArray(value) && value.every((v) => typeof v === "string" && /^\d{5}$/.test(v));
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Rules across two settings.
// ---------------------------------------------------------------------------

/**
 * Problems a change would cause with another setting, keyed by the setting
 * being saved. `values` is every setting as it would be after the change.
 */
export function crossCheck(key: string, values: ReadonlyMap<string, unknown>): string | null {
  const presets = values.get("tip.presets");
  const preset = values.get("tip.default_preset");
  if ((key === "tip.presets" || key === "tip.default_preset") && Array.isArray(presets) && typeof preset === "number") {
    if (!presets.includes(preset)) {
      return key === "tip.presets"
        ? `The preselected tip (${preset}%) must stay one of the choices. Change the preselected tip first.`
        : `Pick one of the tip choices: ${presets.map((p) => `${p}%`).join(", ")}.`;
    }
  }
  const warning = values.get("staff.ticket_warning_minutes");
  const late = values.get("staff.ticket_late_minutes");
  if ((key === "staff.ticket_warning_minutes" || key === "staff.ticket_late_minutes") && typeof warning === "number" && typeof late === "number") {
    if (late <= warning) return "Red must come after amber: make the red time longer than the amber time.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Display.
// ---------------------------------------------------------------------------

const UNIT_LABEL: Record<"minutes" | "hours" | "days" | "seconds", [string, string]> = {
  minutes: ["minute", "minutes"],
  hours: ["hour", "hours"],
  days: ["day", "days"],
  seconds: ["second", "seconds"],
};

/** The value as a sentence fragment ("$25.00", "4.712%", "15 minutes", "On"). */
export function formatSettingValue(def: SettingDefinition, value: unknown): string {
  if (value === undefined || value === null) return "Not set";
  switch (def.type) {
    case "money":
      return typeof value === "number" ? formatCents(value) : String(value);
    case "percent": {
      if (typeof value !== "number") return String(value);
      const percent = def.storage === "fraction" ? value * 100 : value;
      return `${Number(percent.toFixed(def.decimals))}%`;
    }
    case "minutes":
    case "hours":
    case "days":
    case "seconds": {
      if (typeof value !== "number") return String(value);
      const [one, many] = UNIT_LABEL[def.type];
      return `${value} ${value === 1 ? one : many}`;
    }
    case "number":
      if (typeof value !== "number") return String(value);
      if (value === 0 && def.zeroMeans) return def.zeroMeans;
      return def.unit ? `${value} ${def.unit}` : String(value);
    case "boolean":
      return value === true ? def.onLabel : def.offLabel;
    case "email":
      return typeof value === "string" && value ? value : "Not set";
    case "text":
      return typeof value === "string" && value ? value : "Empty";
    case "list":
      if (!Array.isArray(value)) return String(value);
      if (def.item === "zip") return `${value.length} ZIP code${value.length === 1 ? "" : "s"}`;
      return value.map((v) => (v === 0 ? "No tip" : `${v}%`)).join(", ");
  }
}

/** What the form field starts with for a stored value. */
export function settingInputValue(def: SettingDefinition, value: unknown): string | boolean {
  switch (def.type) {
    case "boolean":
      return value === true;
    case "money":
      return typeof value === "number" ? (value / 100).toFixed(2) : "";
    case "percent":
      return typeof value === "number"
        ? String(Number((def.storage === "fraction" ? value * 100 : value).toFixed(def.decimals)))
        : "";
    case "list":
      return Array.isArray(value) ? value.join(def.item === "zip" ? " " : ", ") : "";
    default:
      return value === undefined || value === null ? "" : String(value);
  }
}

/** The default as stored. */
export function storedDefault(def: SettingDefinition): unknown {
  if (def.type === "percent" && def.storage === "fraction") return Number((def.default / 100).toFixed(def.decimals + 2));
  return def.default;
}

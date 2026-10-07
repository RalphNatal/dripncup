import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SETTINGS,
  SETTING_SECTIONS,
  crossCheck,
  formatSettingValue,
  isValidStoredValue,
  parseSettingInput,
  settingDefinition,
  settingInputValue,
  storageRule,
  storedDefault,
} from "./registry";

const def = (key: string) => {
  const found = settingDefinition(key);
  if (!found) throw new Error(`no setting ${key}`);
  return found;
};

/** The `-- registry:start` ... `-- registry:end` block of the migration that sets each key's type and limits. */
function migrationRules(): Map<string, { valueType: string; min: number | null; max: number | null }> {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/20260101000026_admin_foundation.sql"), "utf8");
  const block = sql.slice(sql.indexOf("-- registry:start"), sql.indexOf("-- registry:end"));
  const rules = new Map<string, { valueType: string; min: number | null; max: number | null }>();
  for (const match of block.matchAll(/\('([a-z_.]+)', '([a-z_]+)', (null|[\d.]+), (null|[\d.]+)\)/g)) {
    const num = (v: string) => (v === "null" ? null : Number(v));
    rules.set(match[1], { valueType: match[2], min: num(match[3]), max: num(match[4]) });
  }
  return rules;
}

describe("the registry", () => {
  it("has unique keys, each in a known section", () => {
    const keys = SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    const sections = new Set<string>(SETTING_SECTIONS.map((s) => s.id));
    for (const setting of SETTINGS) expect(sections.has(setting.section), setting.key).toBe(true);
  });

  it("agrees with the database's type and limits for every key, both ways", () => {
    const rules = migrationRules();
    expect(rules.size).toBeGreaterThan(30);
    for (const setting of SETTINGS) {
      expect(rules.get(setting.key), setting.key).toEqual(storageRule(setting));
    }
    for (const key of rules.keys()) expect(settingDefinition(key), `${key} is in the migration but not the registry`).not.toBeNull();
  });

  it("has defaults that are themselves valid", () => {
    for (const setting of SETTINGS) {
      expect(isValidStoredValue(setting, storedDefault(setting)), setting.key).toBe(true);
    }
  });

  it("round-trips every default through the form", () => {
    for (const setting of SETTINGS) {
      const parsed = parseSettingInput(setting, settingInputValue(setting, storedDefault(setting)));
      expect(parsed, setting.key).toEqual({ ok: true, value: storedDefault(setting) });
    }
  });
});

describe("parseSettingInput", () => {
  it("stores the GET rate as a fraction without float noise", () => {
    expect(parseSettingInput(def("tax.get_rate"), "4.712")).toEqual({ ok: true, value: 0.04712 });
    expect(parseSettingInput(def("tax.get_rate"), "4.5%")).toEqual({ ok: true, value: 0.045 });
    expect(parseSettingInput(def("tax.get_rate"), "4.7125").ok).toBe(false);
    expect(parseSettingInput(def("tax.get_rate"), "25").ok).toBe(false);
    expect(parseSettingInput(def("tax.get_rate"), "four").ok).toBe(false);
  });

  it("stores money in cents", () => {
    expect(parseSettingInput(def("catering.delivery_fee_cents"), "$25")).toEqual({ ok: true, value: 2500 });
    expect(parseSettingInput(def("catering.delivery_fee_cents"), "19.99")).toEqual({ ok: true, value: 1999 });
    expect(parseSettingInput(def("catering.delivery_fee_cents"), "19.999").ok).toBe(false);
    expect(parseSettingInput(def("catering.delivery_fee_cents"), "1,000.01")).toEqual({
      ok: false,
      message: "Enter an amount from $0.00 to $1,000.00.",
    });
  });

  it("checks whole numbers and their range", () => {
    expect(parseSettingInput(def("orders.pending_expiry_minutes"), "45")).toEqual({ ok: true, value: 45 });
    expect(parseSettingInput(def("orders.pending_expiry_minutes"), "5")).toEqual({ ok: false, message: "Enter a number from 10 to 240 minutes." });
    expect(parseSettingInput(def("orders.pending_expiry_minutes"), "30.5")).toEqual({ ok: false, message: "Enter a whole number." });
    expect(parseSettingInput(def("loyalty.points_per_dollar"), "1.25")).toEqual({ ok: true, value: 1.25 });
    expect(parseSettingInput(def("loyalty.points_per_dollar"), "1.255").ok).toBe(false);
  });

  it("sorts and checks tip choices", () => {
    expect(parseSettingInput(def("tip.presets"), "20, 15%, 0, 18")).toEqual({ ok: true, value: [0, 15, 18, 20] });
    expect(parseSettingInput(def("tip.presets"), "15, 15").ok).toBe(false);
    expect(parseSettingInput(def("tip.presets"), "15, 120")).toEqual({ ok: false, message: "“120” isn't a whole percentage from 0 to 100." });
    expect(parseSettingInput(def("tip.presets"), "").ok).toBe(false);
  });

  it("checks ZIP codes and drops repeats", () => {
    expect(parseSettingInput(def("catering.delivery_zip_codes"), "96814 96815\n96814")).toEqual({ ok: true, value: ["96814", "96815"] });
    expect(parseSettingInput(def("catering.delivery_zip_codes"), "96814, 9681")).toEqual({ ok: false, message: "“9681” isn't a 5-digit ZIP code." });
  });

  it("checks emails, required or not", () => {
    expect(parseSettingInput(def("catering.admin_notification_email"), " hi@drincupcafe.com ")).toEqual({ ok: true, value: "hi@drincupcafe.com" });
    expect(parseSettingInput(def("catering.admin_notification_email"), "").ok).toBe(false);
    expect(parseSettingInput(def("notifications.reply_to_email"), "")).toEqual({ ok: true, value: "" });
    expect(parseSettingInput(def("notifications.reply_to_email"), "not-an-email").ok).toBe(false);
  });

  it("reads checkboxes", () => {
    expect(parseSettingInput(def("tax.tips_taxed"), true)).toEqual({ ok: true, value: true });
    expect(parseSettingInput(def("tax.tips_taxed"), "on")).toEqual({ ok: true, value: true });
    expect(parseSettingInput(def("tax.tips_taxed"), "")).toEqual({ ok: true, value: false });
  });

  it("checks text length", () => {
    expect(parseSettingInput(def("loyalty.program_name"), "X").ok).toBe(false);
    expect(parseSettingInput(def("loyalty.program_name"), "  Cup Club ")).toEqual({ ok: true, value: "Cup Club" });
  });
});

describe("crossCheck", () => {
  const values = (entries: Record<string, unknown>) => new Map(Object.entries(entries));

  it("keeps the preselected tip among the choices", () => {
    expect(crossCheck("tip.presets", values({ "tip.presets": [0, 15, 20], "tip.default_preset": 18 }))).toMatch(/must stay one of the choices/);
    expect(crossCheck("tip.default_preset", values({ "tip.presets": [0, 15, 20], "tip.default_preset": 18 }))).toBe("Pick one of the tip choices: 0%, 15%, 20%.");
    expect(crossCheck("tip.presets", values({ "tip.presets": [0, 18], "tip.default_preset": 18 }))).toBeNull();
  });

  it("keeps red after amber on tickets", () => {
    expect(crossCheck("staff.ticket_late_minutes", values({ "staff.ticket_warning_minutes": 5, "staff.ticket_late_minutes": 5 }))).toMatch(/Red must come after amber/);
    expect(crossCheck("staff.ticket_late_minutes", values({ "staff.ticket_warning_minutes": 5, "staff.ticket_late_minutes": 6 }))).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(crossCheck("tax.get_rate", values({ "tip.presets": [0], "tip.default_preset": 18 }))).toBeNull();
  });
});

describe("formatSettingValue", () => {
  it("reads naturally", () => {
    expect(formatSettingValue(def("tax.get_rate"), 0.04712)).toBe("4.712%");
    expect(formatSettingValue(def("tip.presets"), [0, 15, 18])).toBe("No tip, 15%, 18%");
    expect(formatSettingValue(def("tip.custom_max_cents"), 10000)).toBe("$100.00");
    expect(formatSettingValue(def("orders.queue_minutes_per_order"), 1)).toBe("1 minute");
    expect(formatSettingValue(def("orders.max_orders_per_slot"), 0)).toBe("No limit");
    expect(formatSettingValue(def("loyalty.points_expire_after_months"), 0)).toBe("Points never expire");
    expect(formatSettingValue(def("staff.label_width_mm"), 57)).toBe("57 mm");
    expect(formatSettingValue(def("tax.tips_taxed"), false)).toBe("Tips are not taxed");
    expect(formatSettingValue(def("catering.delivery_zip_codes"), ["96814"])).toBe("1 ZIP code");
  });
});

import "server-only";

/**
 * The setup checklist: everything still waiting for the owner's say-so.
 * Driven by data, so it stays right as things change:
 *
 *   settings  every registry setting flagged needsConfirmation
 *             (src/lib/settings/registry.ts), with its current value
 *   content   every site content item (About, contact, policies, logo)
 *   tasks     the setup_tasks rows (real menu, hours, POS, printers, ...)
 *
 * Confirmation is stamped on the row (confirmed_at / confirmed_by).
 */
import { CONTENT_ITEMS } from "@/lib/content/registry";
import { SETTINGS, SETTING_SECTIONS, formatSettingValue } from "@/lib/settings/registry";
import { createClient } from "@/lib/supabase/server";

export type SetupKind = "setting" | "content" | "task";

export interface SetupItem {
  kind: SetupKind;
  key: string;
  label: string;
  group: string;
  help: string;
  /** The value in place now (a placeholder until confirmed). */
  current: string;
  href: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export interface SetupChecklist {
  items: SetupItem[];
  confirmed: number;
  total: number;
}

const preview = (text: string, max = 140) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export async function getSetupChecklist(): Promise<SetupChecklist> {
  const supabase = await createClient();
  const [settings, content, tasks, people] = await Promise.all([
    supabase.from("settings").select("key, value, confirmed_at, confirmed_by"),
    supabase.from("site_content").select("key, value, confirmed_at, confirmed_by"),
    supabase.from("setup_tasks").select("key, label, help, edit_href, sort_order, confirmed_at, confirmed_by").order("sort_order"),
    supabase.from("profiles").select("id, full_name, email").eq("role", "admin"),
  ]);
  const name = (id: string | null) => {
    if (!id) return null;
    const person = people.data?.find((p) => p.id === id);
    return person?.full_name || person?.email || "An admin";
  };

  const items: SetupItem[] = [];
  for (const task of tasks.data ?? []) {
    items.push({
      kind: "task", key: task.key, label: task.label, group: "Menu, hours & hardware", help: task.help, current: task.help,
      href: task.edit_href, confirmedAt: task.confirmed_at, confirmedBy: name(task.confirmed_by),
    });
  }
  for (const item of CONTENT_ITEMS) {
    const row = content.data?.find((r) => r.key === item.key);
    const value = row?.value ?? "";
    items.push({
      kind: "content", key: item.key, label: item.label, group: "Pages & contact", help: item.help,
      current: item.kind === "image" ? (value ? "Logo uploaded" : "No logo yet (typeset wordmark)") : value ? preview(value) : "Not set",
      href: `/admin/content#${item.key}`, confirmedAt: row?.confirmed_at ?? null, confirmedBy: name(row?.confirmed_by ?? null),
    });
  }
  for (const setting of SETTINGS.filter((s) => s.needsConfirmation)) {
    const row = settings.data?.find((r) => r.key === setting.key);
    const section = SETTING_SECTIONS.find((s) => s.id === setting.section)!;
    items.push({
      kind: "setting", key: setting.key, label: setting.label, group: `Settings · ${section.title}`, help: setting.help,
      current: formatSettingValue(setting, row?.value), href: `/admin/settings#${setting.key}`,
      confirmedAt: row?.confirmed_at ?? null, confirmedBy: name(row?.confirmed_by ?? null),
    });
  }

  const confirmed = items.filter((i) => i.confirmedAt).length;
  return { items, confirmed, total: items.length };
}

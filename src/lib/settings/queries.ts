import "server-only";

/** Settings as the admin screen shows them: every registry key's stored value and confirmation. */
import { createClient } from "@/lib/supabase/server";

import { SETTINGS } from "./registry";

export interface StoredSetting {
  key: string;
  value: unknown;
  confirmedAt: string | null;
  updatedAt: string | null;
}

export async function getStoredSettings(): Promise<Map<string, StoredSetting>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings")
    .select("key, value, confirmed_at, updated_at")
    .in("key", SETTINGS.map((s) => s.key));
  if (error) throw new Error(`Settings: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.key, { key: row.key, value: row.value, confirmedAt: row.confirmed_at, updatedAt: row.updated_at }]));
}

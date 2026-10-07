import "server-only";

/**
 * Reading the admin audit log (admins only, by RLS). Written by the
 * audit_admin_change() trigger; see 20260101000026_admin_foundation.sql.
 */
import { addDaysToKey } from "@/lib/reports/definitions";
import { createClient } from "@/lib/supabase/server";
import { cafeInstant } from "@/lib/time";

export const AUDIT_TABLES: Record<string, { label: string; href?: (rowId: string) => string }> = {
  products: { label: "Product", href: (id) => `/admin/menu/products/${id}` },
  product_sizes: { label: "Product size" },
  product_modifier_groups: { label: "Product modifier link", href: (id) => `/admin/menu/products/${id.split("/")[0]}` },
  categories: { label: "Menu category", href: () => "/admin/menu/categories" },
  modifier_groups: { label: "Modifier group", href: (id) => `/admin/menu/modifiers/${id}` },
  modifier_options: { label: "Modifier option" },
  location_availability: { label: "Sold out", href: () => "/admin/menu/sold-out" },
  locations: { label: "Location", href: () => "/admin/locations" },
  location_hours: { label: "Opening hours", href: () => "/admin/locations" },
  closures: { label: "Closure", href: () => "/admin/locations" },
  event_menu_items: { label: "Event menu", href: (id) => `/admin/events/${id.split("/")[0]}` },
  collections: { label: "Collection", href: (id) => `/admin/collections/${id}` },
  collection_products: { label: "Collection product", href: (id) => `/admin/collections/${id.split("/")[0]}` },
  promos: { label: "Promo code", href: (id) => `/admin/promos/${id}` },
  rewards: { label: "Reward tier", href: (id) => `/admin/rewards/tiers/${id}` },
  loyalty_transactions: { label: "Points adjustment" },
  settings: { label: "Setting", href: (key) => `/admin/settings#${key}` },
  site_content: { label: "Pages & contact", href: (key) => `/admin/content#${key}` },
  setup_tasks: { label: "Setup checklist", href: () => "/admin/setup" },
  profiles: { label: "User", href: (id) => `/admin/users/${id}` },
  staff_locations: { label: "Staff location", href: (id) => `/admin/users/${id.split("/")[0]}` },
  orders: { label: "Order", href: (id) => `/admin/orders/${id}` },
  refunds: { label: "Refund" },
  email_outbox: { label: "Email" },
};

export interface AuditChange {
  column: string;
  from: unknown;
  to: unknown;
}

export interface AuditEntry {
  id: number;
  createdAt: string;
  actorId: string;
  actorName: string | null;
  table: string;
  tableLabel: string;
  rowId: string | null;
  rowLabel: string | null;
  href: string | null;
  action: "create" | "update" | "delete" | "import";
  summary: string | null;
  changes: AuditChange[];
}

export interface AuditFilters {
  actor?: string;
  table?: string;
  rowId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize?: number;
}

function toEntry(row: {
  id: number;
  created_at: string;
  actor_id: string;
  actor_name: string | null;
  table_name: string;
  row_id: string | null;
  row_label: string | null;
  action: string;
  summary: string | null;
  changes: unknown;
}): AuditEntry {
  const meta = AUDIT_TABLES[row.table_name];
  const raw = (row.changes && typeof row.changes === "object" ? row.changes : {}) as Record<string, { from?: unknown; to?: unknown } | unknown>;
  const changes =
    row.action === "import"
      ? []
      : Object.entries(raw).map(([column, value]) => {
          const pair = (value ?? {}) as { from?: unknown; to?: unknown };
          return { column, from: pair.from ?? null, to: pair.to ?? null };
        });
  return {
    id: row.id,
    createdAt: row.created_at,
    actorId: row.actor_id,
    actorName: row.actor_name,
    table: row.table_name,
    tableLabel: meta?.label ?? row.table_name,
    rowId: row.row_id,
    rowLabel: row.row_label,
    href: row.row_id && meta?.href && row.action !== "delete" ? meta.href(row.row_id) : null,
    action: row.action as AuditEntry["action"],
    summary: row.summary,
    changes,
  };
}

export async function listAudit(filters: AuditFilters): Promise<{ entries: AuditEntry[]; total: number }> {
  const supabase = await createClient();
  const pageSize = filters.pageSize ?? 25;
  let query = supabase
    .from("admin_audit_log")
    .select("id, created_at, actor_id, actor_name, table_name, row_id, row_label, action, summary, changes", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((filters.page - 1) * pageSize, filters.page * pageSize - 1);
  if (filters.actor) query = query.eq("actor_id", filters.actor);
  if (filters.table) query = query.eq("table_name", filters.table);
  if (filters.rowId) query = query.eq("row_id", filters.rowId);
  const from = filters.from ? cafeInstant(filters.from, "00:00") : null;
  const to = filters.to ? cafeInstant(addDaysToKey(filters.to, 1), "00:00") : null;
  if (from) query = query.gte("created_at", from.toISOString());
  if (to) query = query.lt("created_at", to.toISOString());

  const { data, error, count } = await query;
  if (error) throw new Error(`Audit log: ${error.message}`);
  return { entries: (data ?? []).map(toEntry), total: count ?? 0 };
}

/** Everyone who appears in the log, for the person filter. */
export async function listAuditActors(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("admin_audit_log").select("actor_id, actor_name").order("created_at", { ascending: false }).limit(2000);
  const seen = new Map<string, string>();
  for (const row of data ?? []) if (!seen.has(row.actor_id)) seen.set(row.actor_id, row.actor_name ?? "Admin");
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The latest changes to one row (a setting's history). */
export async function rowHistory(table: string, rowIds: string[], perRow = 5): Promise<Map<string, AuditEntry[]>> {
  const result = new Map<string, AuditEntry[]>();
  if (rowIds.length === 0) return result;
  const supabase = await createClient();
  const { data } = await supabase
    .from("admin_audit_log")
    .select("id, created_at, actor_id, actor_name, table_name, row_id, row_label, action, summary, changes")
    .eq("table_name", table)
    .in("row_id", rowIds)
    .order("created_at", { ascending: false })
    .limit(500);
  for (const row of data ?? []) {
    const list = result.get(row.row_id ?? "") ?? [];
    if (list.length < perRow) list.push(toEntry(row));
    result.set(row.row_id ?? "", list);
  }
  return result;
}

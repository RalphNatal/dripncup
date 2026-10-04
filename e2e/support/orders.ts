/**
 * Orders, staff and email for the Phase 5 suite.
 *
 *   arrangePlacedOrder  a Placed order with real catalogue lines, made through
 *                       the same SQL functions checkout and the webhook use
 *                       (no Stripe: the payment is recorded directly)
 *   signedInClient      a Supabase client signed in as a real user, so RPCs
 *                       and Realtime run under that user's RLS -- e.g. the
 *                       seeded barista calling advance_order_status
 *   mailpit             the local inbox the dev email provider sends to
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/types/database";

import { SEEDED, TEST_PASSWORD, db, locationIdBySlug, must } from "./db";

export const BARISTA = "barista@drincup.test";

export interface ArrangedLine {
  productSlug: string;
  sizeName?: string;
  options?: { groupSlug: string; name: string; quantity?: number }[];
  quantity?: number;
  specialInstructions?: string;
  /** What one cost at the time; defaults to the current catalogue price. */
  unitPriceCents?: number;
}

async function snapshotLine(line: ArrangedLine) {
  const product = must(
    await db().from("products").select("id, name, base_price_cents").eq("slug", line.productSlug).single(),
    `product ${line.productSlug}`,
  );
  const size = line.sizeName
    ? must(
        await db().from("product_sizes").select("id, name, price_cents").eq("product_id", product.id).eq("name", line.sizeName).single(),
        `size ${line.sizeName}`,
      )
    : null;
  const modifiers = [];
  let deltas = 0;
  for (const option of line.options ?? []) {
    const group = must(
      await db().from("modifier_groups").select("id, name, charge_per_quantity, quantity_unit").eq("slug", option.groupSlug).single(),
      `group ${option.groupSlug}`,
    );
    const row = must(
      await db()
        .from("modifier_options")
        .select("id, name, price_delta_cents")
        .eq("modifier_group_id", group.id)
        .eq("name", option.name)
        .single(),
      `option ${option.name}`,
    );
    const quantity = option.quantity ?? 1;
    deltas += row.price_delta_cents * (group.charge_per_quantity ? quantity : 1);
    modifiers.push({
      group_id: group.id,
      group_name: group.name,
      option_id: row.id,
      option_name: row.name,
      quantity,
      price_delta_cents: row.price_delta_cents,
      charge_per_quantity: group.charge_per_quantity,
      quantity_unit: group.quantity_unit,
    });
  }
  const base = size?.price_cents ?? product.base_price_cents;
  const unit = line.unitPriceCents ?? base + deltas;
  const quantity = line.quantity ?? 1;
  return {
    product_id: product.id,
    product_size_id: size?.id ?? null,
    product_name: product.name,
    size_name: size?.name ?? null,
    modifiers,
    base_price_cents: base,
    unit_price_cents: unit,
    quantity,
    line_total_cents: unit * quantity,
    special_instructions: line.specialInstructions ?? "",
  };
}

/** A Placed order for `userId`, as checkout + a confirmed payment would leave it. */
export async function arrangePlacedOrder({
  userId,
  lines,
  locationSlug = SEEDED.cafeSlug,
  scheduledFor,
  cupName = "Kai",
  notes,
  pointsEarned = 0,
}: {
  userId: string;
  lines: ArrangedLine[];
  locationSlug?: string;
  /** A scheduled pickup instead of ASAP. */
  scheduledFor?: Date;
  cupName?: string;
  notes?: string;
  /** Points the order earns at pickup, as checkout would have worked out. */
  pointsEarned?: number;
}) {
  const locationId = await locationIdBySlug(locationSlug);
  const items = await Promise.all(lines.map(snapshotLine));
  const subtotal = items.reduce((sum, item) => sum + item.line_total_cents, 0);
  const key = `e2e-placed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const created = must(
    await db().rpc("create_checkout_order", {
      p_order: {
        user_id: userId,
        location_id: locationId,
        pickup_type: scheduledFor ? "scheduled" : "asap",
        scheduled_for: scheduledFor?.toISOString() ?? null,
        estimated_ready_at: (scheduledFor ?? new Date(Date.now() + 10 * 60_000)).toISOString(),
        subtotal_cents: subtotal,
        discount_cents: 0,
        taxable_base_cents: subtotal,
        tax_rate: 0,
        tax_cents: 0,
        tip_cents: 0,
        total_cents: subtotal,
        points_earned: pointsEarned,
        customer_first_name: cupName,
        notes: notes ?? null,
        idempotency_key: key,
        checkout_fingerprint: key,
      },
      p_items: items,
    }),
    "create_checkout_order",
  );
  const orderId = created[0].order_id;
  const outcome = must(
    await db().rpc("mark_order_paid", {
      p_order_id: orderId,
      p_payment_intent_id: `pi_e2e_${key}`,
      p_charge_id: `ch_e2e_${key}`,
      p_amount_cents: subtotal,
      p_currency: "usd",
    }),
    "mark_order_paid",
  );
  if (outcome !== "placed") throw new Error(`Arranged order was not placed: ${outcome}`);
  const order = must(await db().from("orders").select("order_number").eq("id", orderId).single(), "order number");
  return { orderId, orderNumber: order.order_number, subtotalCents: subtotal };
}

/** Walks an order to `status` with the service role (test arrangement, not the staff path). */
export async function forceStatus(orderId: string, path: Database["public"]["Enums"]["order_status"][]) {
  for (const status of path) {
    must(await db().from("orders").update({ status }).eq("id", orderId).select("id").single(), `status ${status}`);
  }
}

const clients: SupabaseClient<Database>[] = [];

/** A Supabase client signed in as `email`: everything it does runs under that user's RLS. */
export async function signedInClient(email: string, password = TEST_PASSWORD): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message}`);
  await client.realtime.setAuth(data.session.access_token);
  clients.push(client);
  return client;
}

export async function closeClients() {
  for (const client of clients.splice(0)) {
    await client.removeAllChannels();
    await client.auth.signOut().catch(() => undefined);
  }
}

/** The barista's move, exactly as the staff dashboard will make it. */
export async function advance(staff: SupabaseClient<Database>, orderId: string, status: "accepted" | "preparing" | "ready" | "picked_up") {
  const { error } = await staff.rpc("advance_order_status", { p_order_id: orderId, p_new_status: status });
  if (error) throw new Error(`advance_order_status ${status}: ${error.message}`);
}

/**
 * Subscribes `client` to changes on one order and records what arrives.
 * Resolves once Realtime reports its database listener running (the channel
 * join is acknowledged a moment earlier, and a change in between is missed).
 */
export async function watchOrder(client: SupabaseClient<Database>, orderId: string) {
  const received: string[] = [];
  const channel = client
    .channel(`e2e-watch-${orderId}-${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `id=eq.${orderId}` }, (payload) => {
      received.push(String((payload.new as { status?: string }).status));
    });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Realtime channel never started listening")), 15_000);
    channel.on("system", {}, (payload: { extension?: string; status?: string }) => {
      if (payload?.extension === "postgres_changes" && payload.status === "ok") {
        clearTimeout(timer);
        resolve();
      }
    });
    channel.subscribe();
  });
  return received;
}

// ---------------------------------------------------------------------------
// Mailpit (the local Supabase stack's inbox).
// ---------------------------------------------------------------------------

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

export interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function mailTo(address: string): Promise<MailpitSummary[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  return ((await response.json()) as { messages: MailpitSummary[] }).messages;
}

export async function mailBody(id: string): Promise<{ Text: string; HTML: string; Subject: string }> {
  const response = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!response.ok) throw new Error(`Mailpit message failed: ${response.status}`);
  return response.json();
}

/** Waits for at least `count` emails to `address`. */
export async function waitForMail(address: string, count = 1, timeoutMs = 20_000): Promise<MailpitSummary[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await mailTo(address);
    if (messages.length >= count) return messages;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Expected ${count} email(s) to ${address} within ${timeoutMs / 1000}s`);
}

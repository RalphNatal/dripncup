/**
 * Catering, events and collections in the e2e suite: arranging requests and
 * quotes through the same SQL functions the app uses, paying a quote in
 * Stripe's sandbox, and the controllable clock.
 *
 * The clock: the test server (and only it; src/lib/test-clock.ts) shifts its
 * request clock by the `dc_test_clock` cookie, in milliseconds. Setting it on
 * one browser context moves "now" for that context's pages and Server
 * Actions: which events are live, which collections and limited-time
 * products show, the staff prep list's day, quote expiry checks. The
 * database's own now() is untouched.
 */
import type { BrowserContext } from "@playwright/test";
import Stripe from "stripe";

import { SEEDED, db, locationIdBySlug, must } from "./db";
import { stripe } from "./stripe";

export const ADMIN_NOTIFICATION_EMAIL = "catering@drincup.test";

/** Shifts this context's server clock so that "now" is `at`. */
export async function setClock(context: BrowserContext, at: Date, baseURL = "http://localhost:3100") {
  await context.addCookies([{ name: "dc_test_clock", value: String(at.getTime() - Date.now()), url: baseURL }]);
}

export async function resetClock(context: BrowserContext) {
  await context.clearCookies({ name: "dc_test_clock" });
}

/** `HH:MM` on the Honolulu date `daysAhead` from today, as an instant. */
export function honoluluAt(daysAhead: number, time: string): Date {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu" }).format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${date}T${time}:00-10:00`);
}

/** "YYYY-MM-DD" in Honolulu, `daysAhead` from today. */
export function honoluluDate(daysAhead: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu" }).format(new Date(Date.now() + daysAhead * 86_400_000));
}

export async function adminId(): Promise<string> {
  return must(await db().from("profiles").select("id").eq("email", SEEDED.admin).single(), "admin profile").id;
}

export interface ArrangedRequest {
  id: string;
  number: string;
  eventAt: Date;
}

/** A submitted request, created the way submitCateringRequestAction does. */
export async function arrangeCateringRequest({
  userId,
  email,
  eventAt = honoluluAt(5, "11:00"),
  headcount = 25,
  fulfillment = "pickup",
}: {
  userId: string;
  email: string;
  eventAt?: Date;
  headcount?: number;
  fulfillment?: "pickup" | "delivery";
}): Promise<ArrangedRequest> {
  const coldBrew = must(await db().from("products").select("id, name").eq("slug", "cold-brew").single(), "cold brew");
  const medium = must(await db().from("product_sizes").select("id, name").eq("product_id", coldBrew.id).eq("name", "Medium").single(), "medium");
  const rows = must(
    await db().rpc("create_catering_request", {
      p_user_id: userId,
      p_request: {
        location_id: await locationIdBySlug(SEEDED.cafeSlug),
        contact_name: "Kai E2E",
        contact_email: email,
        contact_phone: "(808) 555-0142",
        event_at: eventAt.toISOString(),
        headcount,
        fulfillment,
        delivery_address: fulfillment === "delivery" ? "1 Test St, Honolulu" : null,
        delivery_postal_code: fulfillment === "delivery" ? "96814" : null,
        custom_drink_request: "Something tropical for our team day.",
        notes: "e2e request",
      },
      p_items: [
        { product_id: coldBrew.id, product_size_id: medium.id, product_name: coldBrew.name, size_name: medium.name, quantity: headcount },
        { product_id: null, product_size_id: null, product_name: "Custom signature drink", size_name: null, quantity: headcount },
      ],
    }),
    "create_catering_request",
  );
  return { id: rows[0].request_id, number: rows[0].request_number, eventAt };
}

/** Issues a quote through catering_issue_quote (as issueQuoteAction would, untaxed for simple sums). */
export async function arrangeQuote(requestId: string, { totalCents = 9000, expiresAt = new Date(Date.now() + 2 * 86_400_000) } = {}) {
  return must(
    await db().rpc("catering_issue_quote", {
      p_actor: await adminId(),
      p_request_id: requestId,
      p_quote: {
        items_subtotal_cents: totalCents,
        discount_cents: 0,
        delivery_fee_cents: 0,
        delivery_fee_taxable: true,
        taxable_cents: totalCents,
        tax_rate: 0,
        tax_cents: 0,
        gratuity_cents: 0,
        total_cents: totalCents,
        expires_at: expiresAt.toISOString(),
        note_to_customer: null,
      },
      p_lines: [
        {
          kind: "custom",
          product_id: null,
          product_size_id: null,
          description: "Signature drink: E2E Sunrise",
          size_name: null,
          quantity: 1,
          unit_price_cents: totalCents,
          line_total_cents: totalCents,
        },
      ],
    }),
    "catering_issue_quote",
  );
}

/**
 * A request paid in Stripe's sandbox and confirmed: a real PaymentIntent,
 * tagged like the app's own (type=catering), paid with a test card, its
 * success applied through mark_catering_paid as the webhook would.
 */
export async function arrangeConfirmedCatering(user: { id: string; email: string }, totalCents = 9000) {
  const request = await arrangeCateringRequest({ userId: user.id, email: user.email });
  const quoteId = await arrangeQuote(request.id, { totalCents });
  let intent = await stripe().paymentIntents.create({
    amount: totalCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: `[e2e] Arranged catering ${request.number}`,
    metadata: {
      type: "catering",
      catering_request_id: request.id,
      catering_quote_id: quoteId,
      request_number: request.number,
      source: "e2e",
      e2e_run: process.env.E2E_RUN_ID ?? "manual",
    },
  });
  must(
    await db()
      .from("payments")
      .insert({
        catering_request_id: request.id,
        catering_quote_id: quoteId,
        provider: "stripe",
        provider_payment_intent_id: intent.id,
        status: "requires_payment",
        amount_cents: totalCents,
        tip_cents: 0,
      })
      .select()
      .single(),
    "catering payment row",
  );
  intent = await stripe().paymentIntents.confirm(intent.id, { payment_method: "pm_card_visa" });
  if (intent.status !== "succeeded") throw new Error(`Arranged catering payment did not succeed: ${intent.status}`);
  const charge = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge as Stripe.Charge | null)?.id;
  const outcome = must(
    await db().rpc("mark_catering_paid", {
      p_request_id: request.id,
      p_quote_id: quoteId,
      p_payment_intent_id: intent.id,
      p_charge_id: charge ?? "",
      p_amount_cents: totalCents,
      p_currency: "usd",
    }),
    "mark_catering_paid",
  );
  if (outcome !== "confirmed") throw new Error(`mark_catering_paid said ${outcome}`);
  return { ...request, quoteId, intentId: intent.id };
}

export async function cateringRow(id: string) {
  return must(
    await db().from("catering_requests").select("status, current_quote_id, cancellation_reason").eq("id", id).single(),
    "catering row",
  );
}

/** The newest PaymentIntent recorded for a catering request (created by the pay page). */
export async function latestCateringIntent(requestId: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await db()
      .from("payments")
      .select("provider_payment_intent_id")
      .eq("catering_request_id", requestId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.provider_payment_intent_id) return data.provider_payment_intent_id;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No payment was started for catering request ${requestId}`);
}

import { Column, Hr, Row, Section, Text } from "react-email";

import { BRAND } from "@/lib/brand";

import { ActionButton, INK, LINE, Layout, MAGENTA_DEEP, Panel, Title, muted, text, textFooter } from "./layout";
import type { EmailBreakdownRow } from "./order-emails";

/** Everything a catering email shows, preformatted by the composer. */
export interface CateringEmailData {
  requestNumber: string;
  firstName: string | null;
  /** "Sat, Oct 18 at 11:00 AM" */
  eventWhen: string;
  headcount: number;
  /** "Pickup at Drincup Cafe — Kapiolani" / "Delivery to 500 Ala Moana Blvd, 96813" */
  fulfillmentLine: string;
  /** What the customer asked for: "20 × Latte (16 oz)", "Custom signature drink". */
  requested: string[];
  customDrink: string | null;
  requestUrl: string;
}

export interface CateringQuoteEmailData {
  version: number;
  lines: { quantity: number; description: string; total: string }[];
  breakdown: EmailBreakdownRow[];
  /** "Pay by Tue, Oct 14 at 11:00 AM" */
  payBy: string;
  note: string | null;
}

const CATERING_FOOTER = "You're getting this email about a catering request you made with us. Updates about it are always sent.";
const ADMIN_FOOTER = "Sent to the catering notification address in the app's settings.";

function RequestNumber({ value }: { value: string }) {
  return (
    <Text style={{ ...muted, margin: "0 0 16px" }}>
      Request <strong style={{ color: INK, fontSize: "15px" }}>{value}</strong>
    </Text>
  );
}

function EventSummary({ data }: { data: CateringEmailData }) {
  return (
    <Panel>
      <Text style={{ ...text, fontWeight: 700, margin: "0 0 4px" }}>
        {data.eventWhen} · {data.headcount} {data.headcount === 1 ? "guest" : "guests"}
      </Text>
      <Text style={{ ...text, margin: 0 }}>{data.fulfillmentLine}</Text>
    </Panel>
  );
}

function Requested({ data }: { data: CateringEmailData }) {
  if (data.requested.length === 0 && !data.customDrink) return null;
  return (
    <Section style={{ margin: "0 0 16px" }}>
      <Text style={{ ...text, fontWeight: 700, margin: "0 0 4px" }}>What you asked for</Text>
      {data.requested.map((line) => (
        <Text key={line} style={{ ...text, margin: "0 0 2px" }}>
          {line}
        </Text>
      ))}
      {data.customDrink ? <Text style={{ ...muted, fontStyle: "italic", margin: "6px 0 0" }}>Signature drink: “{data.customDrink}”</Text> : null}
    </Section>
  );
}

function QuoteTable({ quote, paidWith }: { quote: CateringQuoteEmailData; paidWith?: string | null }) {
  return (
    <Section>
      {quote.lines.map((line, index) => (
        <Row key={index} style={{ borderBottom: `1px solid ${LINE}` }}>
          <Column style={{ padding: "8px 0", verticalAlign: "top" }}>
            <Text style={{ ...text, margin: 0 }}>
              {line.quantity} × {line.description}
            </Text>
          </Column>
          <Column align="right" style={{ padding: "8px 0", verticalAlign: "top", width: "100px" }}>
            <Text style={{ ...text, fontWeight: 700, margin: 0 }}>{line.total}</Text>
          </Column>
        </Row>
      ))}
      <Section style={{ marginTop: "8px" }}>
        {quote.breakdown.map((row) => (
          <Row key={row.label}>
            <Column style={{ padding: "3px 0" }}>
              <Text style={{ ...(row.strong ? text : muted), fontWeight: row.strong ? 800 : 400, margin: 0 }}>{row.label}</Text>
            </Column>
            <Column align="right" style={{ padding: "3px 0", width: "110px" }}>
              <Text style={{ ...(row.strong ? text : muted), fontWeight: row.strong ? 800 : 400, margin: 0 }}>{row.amount}</Text>
            </Column>
          </Row>
        ))}
      </Section>
      {paidWith ? <Text style={{ ...muted, margin: "10px 0 0" }}>Paid with {paidWith}</Text> : null}
    </Section>
  );
}

const greeting = (data: CateringEmailData) => (data.firstName ? `Aloha ${data.firstName},` : "Aloha,");

// ---------------------------------------------------------------------------
// To the customer.
// ---------------------------------------------------------------------------

export function CateringReceivedEmail({ data, leadTimeHours }: { data: CateringEmailData; leadTimeHours: number }) {
  return (
    <Layout preview={`Mahalo! We got catering request ${data.requestNumber}.`} footer={CATERING_FOOTER}>
      <Title>
        <span style={{ color: MAGENTA_DEEP }}>Mahalo!</span> We got your request.
      </Title>
      <RequestNumber value={data.requestNumber} />
      <EventSummary data={data} />
      <Requested data={data} />
      <Text style={{ ...text, fontWeight: 700, margin: "0 0 4px" }}>What happens next</Text>
      <Text style={text}>
        1. We put together a quote for your event, usually within a day or two.
        <br />
        2. You review it and pay online, or ask us for changes.
        <br />
        3. Once it&apos;s paid, you&apos;re confirmed. We&apos;ll remind you the day before.
      </Text>
      <Text style={muted}>We need at least {leadTimeHours} hours&apos; notice for catering, so your date is already in the clear.</Text>
      <ActionButton href={data.requestUrl} label="View your request" />
    </Layout>
  );
}

export function CateringQuoteReadyEmail({ data, quote }: { data: CateringEmailData; quote: CateringQuoteEmailData }) {
  return (
    <Layout preview={`Your catering quote for ${data.eventWhen} is ready.`} footer={CATERING_FOOTER}>
      <Title>{quote.version > 1 ? "Your revised quote is ready" : "Your catering quote is ready"}</Title>
      <RequestNumber value={data.requestNumber} />
      <Text style={text}>{greeting(data)} here&apos;s what we&apos;d love to pour for your event.</Text>
      <EventSummary data={data} />
      {quote.note ? (
        <Panel tone="pink">
          <Text style={{ ...text, margin: 0 }}>{quote.note}</Text>
        </Panel>
      ) : null}
      <QuoteTable quote={quote} />
      <Hr style={{ borderColor: LINE, margin: "20px 0" }} />
      <Text style={{ ...text, fontWeight: 700 }}>{quote.payBy}</Text>
      <Text style={text}>Review the quote, then pay online to confirm, or ask us for changes.</Text>
      <ActionButton href={data.requestUrl} label="Review and pay" />
    </Layout>
  );
}

export function CateringConfirmedEmail({
  data,
  quote,
  paidWith,
}: {
  data: CateringEmailData;
  quote: CateringQuoteEmailData;
  paidWith: string | null;
}) {
  return (
    <Layout preview={`You're confirmed! Catering ${data.requestNumber} on ${data.eventWhen}.`} footer={CATERING_FOOTER}>
      <Title>
        <span style={{ color: MAGENTA_DEEP }}>Mahalo!</span> You&apos;re confirmed.
      </Title>
      <RequestNumber value={data.requestNumber} />
      <EventSummary data={data} />
      <Text style={{ ...text, fontWeight: 700, margin: "0 0 4px" }}>Your receipt</Text>
      <QuoteTable quote={quote} paidWith={paidWith} />
      <Hr style={{ borderColor: LINE, margin: "20px 0" }} />
      <Text style={text}>We&apos;ll send a reminder the day before. Need to change something? Reply through your request page.</Text>
      <ActionButton href={data.requestUrl} label="View your request" />
    </Layout>
  );
}

export function CateringReminderEmail({ data }: { data: CateringEmailData }) {
  return (
    <Layout preview={`See you soon! Catering ${data.requestNumber} is coming up.`} footer={CATERING_FOOTER}>
      <Title>See you soon! 🌺</Title>
      <RequestNumber value={data.requestNumber} />
      <Text style={text}>{greeting(data)} a quick reminder that your catering is coming up.</Text>
      <EventSummary data={data} />
      <ActionButton href={data.requestUrl} label="View the details" />
    </Layout>
  );
}

export function CateringCancelledEmail({ data, reason, refund }: { data: CateringEmailData; reason: string | null; refund: string | null }) {
  return (
    <Layout preview={`Catering ${data.requestNumber} was cancelled${refund ? ` · ${refund}` : ""}`} footer={CATERING_FOOTER}>
      <Title>Your catering request was cancelled</Title>
      <RequestNumber value={data.requestNumber} />
      <EventSummary data={data} />
      {reason ? (
        <Text style={text}>
          <strong>Why:</strong> {reason}
        </Text>
      ) : null}
      {refund ? (
        <Panel tone="pink">
          <Text style={{ ...text, margin: 0 }}>{refund}</Text>
        </Panel>
      ) : null}
      <Text style={text}>We&apos;re sorry it didn&apos;t work out this time. We&apos;d love to help with your next event.</Text>
      <ActionButton href={data.requestUrl} label="View your request" />
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// To the admin.
// ---------------------------------------------------------------------------

export interface AdminCateringEmailData {
  heading: string;
  requestNumber: string;
  rows: { label: string; value: string }[];
  message: string | null;
  adminUrl: string;
}

export function AdminCateringEmail({ data }: { data: AdminCateringEmailData }) {
  return (
    <Layout preview={`${data.heading}: ${data.requestNumber}`} footer={ADMIN_FOOTER}>
      <Title>{data.heading}</Title>
      <RequestNumber value={data.requestNumber} />
      <Section style={{ margin: "0 0 16px" }}>
        {data.rows.map((row) => (
          <Row key={row.label}>
            <Column style={{ padding: "3px 0", width: "130px", verticalAlign: "top" }}>
              <Text style={{ ...muted, margin: 0 }}>{row.label}</Text>
            </Column>
            <Column style={{ padding: "3px 0", verticalAlign: "top" }}>
              <Text style={{ ...text, margin: 0 }}>{row.value}</Text>
            </Column>
          </Row>
        ))}
      </Section>
      {data.message ? (
        <Panel tone="pink">
          <Text style={{ ...text, margin: 0, whiteSpace: "pre-wrap" }}>“{data.message}”</Text>
        </Panel>
      ) : null}
      <ActionButton href={data.adminUrl} label="Open in admin" />
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Plain text, from the same data.
// ---------------------------------------------------------------------------

function textEvent(data: CateringEmailData): string {
  return [`${data.eventWhen} · ${data.headcount} ${data.headcount === 1 ? "guest" : "guests"}`, data.fulfillmentLine].join("\n");
}

function textQuote(quote: CateringQuoteEmailData, paidWith?: string | null): string {
  return [
    ...quote.lines.map((l) => `${l.quantity} x ${l.description}  ${l.total}`),
    "",
    ...quote.breakdown.map((row) => `${row.label}: ${row.amount}`),
    ...(paidWith ? [`Paid with ${paidWith}`] : []),
  ].join("\n");
}

export function cateringReceivedText(data: CateringEmailData, leadTimeHours: number): string {
  return [
    "Mahalo! We got your catering request.",
    `Request ${data.requestNumber}`,
    "",
    textEvent(data),
    ...(data.requested.length ? ["", "What you asked for:", ...data.requested] : []),
    ...(data.customDrink ? [`Signature drink: "${data.customDrink}"`] : []),
    "",
    "What happens next:",
    "1. We put together a quote for your event, usually within a day or two.",
    "2. You review it and pay online, or ask us for changes.",
    "3. Once it's paid, you're confirmed. We'll remind you the day before.",
    `(We need at least ${leadTimeHours} hours' notice for catering.)`,
    "",
    `View your request: ${data.requestUrl}`,
    "",
    textFooter,
  ].join("\n");
}

export function cateringQuoteReadyText(data: CateringEmailData, quote: CateringQuoteEmailData): string {
  return [
    quote.version > 1 ? "Your revised quote is ready" : "Your catering quote is ready",
    `Request ${data.requestNumber}`,
    "",
    textEvent(data),
    ...(quote.note ? ["", quote.note] : []),
    "",
    textQuote(quote),
    "",
    quote.payBy,
    `Review and pay: ${data.requestUrl}`,
    "",
    textFooter,
  ].join("\n");
}

export function cateringConfirmedText(data: CateringEmailData, quote: CateringQuoteEmailData, paidWith: string | null): string {
  return [
    "Mahalo! You're confirmed.",
    `Request ${data.requestNumber}`,
    "",
    textEvent(data),
    "",
    "Your receipt:",
    textQuote(quote, paidWith),
    "",
    "We'll send a reminder the day before.",
    `View your request: ${data.requestUrl}`,
    "",
    textFooter,
  ].join("\n");
}

export function cateringReminderText(data: CateringEmailData): string {
  return ["See you soon!", `Request ${data.requestNumber}`, "", textEvent(data), "", `View the details: ${data.requestUrl}`, "", textFooter].join("\n");
}

export function cateringCancelledText(data: CateringEmailData, reason: string | null, refund: string | null): string {
  return [
    "Your catering request was cancelled",
    `Request ${data.requestNumber}`,
    "",
    textEvent(data),
    ...(reason ? ["", `Why: ${reason}`] : []),
    ...(refund ? [refund] : []),
    "",
    `View your request: ${data.requestUrl}`,
    "",
    textFooter,
  ].join("\n");
}

export function adminCateringText(data: AdminCateringEmailData): string {
  return [
    data.heading,
    `Request ${data.requestNumber}`,
    "",
    ...data.rows.map((row) => `${row.label}: ${row.value}`),
    ...(data.message ? ["", `"${data.message}"`] : []),
    "",
    `Open in admin: ${data.adminUrl}`,
    "",
    `--\n${BRAND.name} catering notifications`,
  ].join("\n");
}

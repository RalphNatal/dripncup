import { Body, Button, Column, Container, Head, Hr, Html, Link, Preview, Row, Section, Text } from "react-email";
import type { CSSProperties, ReactNode } from "react";

import { BRAND, CAFE_ADDRESS_ONE_LINE } from "@/lib/brand";

const TEAL_DEEP = "#0E7C86";
const MAGENTA_DEEP = "#B81C74";
const INK = "#1a1a1a";
const MUTED = "#5b5b5b";
const LINE = "#e7e2dc";
const FONT = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const HEADING_FONT = "'Baloo 2', 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";

export interface EmailLine {
  quantity: number;
  name: string;
  /** "Large · Oat milk · Vanilla (2 pumps)" */
  details: string;
  specialInstructions: string | null;
  /** "Free drink": rewards applied to this line. */
  rewardNotes: string[];
  /** "$11.00" */
  total: string;
}

export interface EmailBreakdownRow {
  label: string;
  /** "$5.75", "−$1.00" */
  amount: string;
  strong?: boolean;
}

export interface OrderEmailData {
  orderNumber: string;
  cupName: string | null;
  locationName: string;
  locationAddress: string | null;
  pickupInstructions: string | null;
  /** "Ready around 9:40 AM", "Pickup Fri, Oct 3 at 10:15 AM" */
  pickupLine: string | null;
  items: EmailLine[];
  breakdown: EmailBreakdownRow[];
  /** "Visa •••• 4242" */
  paymentMethod: string | null;
  /** "You'll earn 12 Overflow Rewards points when you pick this up." */
  pointsLine: string | null;
  trackUrl: string;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const text: CSSProperties = { color: INK, fontSize: "15px", lineHeight: "22px", margin: "0 0 12px" };
const muted: CSSProperties = { ...text, color: MUTED, fontSize: "13px", lineHeight: "19px" };

function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f7f3ee", fontFamily: FONT, margin: 0, padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: "16px", maxWidth: "560px", overflow: "hidden" }}>
          <Section style={{ backgroundColor: TEAL_DEEP, padding: "22px 28px" }}>
            {/* Logo placeholder: the lowercase wordmark until artwork arrives. */}
            <Text style={{ color: "#ffffff", fontFamily: HEADING_FONT, fontSize: "26px", fontWeight: 800, letterSpacing: "0.5px", lineHeight: "30px", margin: 0 }}>
              {BRAND.wordmark}
            </Text>
            <Text style={{ color: "#e6f6f7", fontSize: "13px", lineHeight: "18px", margin: "2px 0 0" }}>{BRAND.taglines.primary}</Text>
          </Section>
          <Section style={{ padding: "28px" }}>{children}</Section>
          <Section style={{ borderTop: `1px solid ${LINE}`, padding: "18px 28px" }}>
            <Text style={muted}>
              {BRAND.name} · {CAFE_ADDRESS_ONE_LINE}
            </Text>
            <Text style={{ ...muted, margin: 0 }}>
              You&apos;re getting this email about an order you placed with us. Receipts and refund updates are always sent.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <Text style={{ color: INK, fontFamily: HEADING_FONT, fontSize: "26px", fontWeight: 800, lineHeight: "32px", margin: "0 0 8px" }}>{children}</Text>;
}

function OrderNumber({ value }: { value: string }) {
  return (
    <Text style={{ ...muted, margin: "0 0 16px" }}>
      Order <strong style={{ color: INK, fontSize: "15px" }}>{value}</strong>
    </Text>
  );
}

function TrackButton({ href, label = "Track your order" }: { href: string; label?: string }) {
  return (
    <Button
      href={href}
      style={{ backgroundColor: TEAL_DEEP, borderRadius: "999px", color: "#ffffff", display: "inline-block", fontSize: "15px", fontWeight: 700, padding: "12px 22px", textDecoration: "none" }}
    >
      {label}
    </Button>
  );
}

function Pickup({ data }: { data: OrderEmailData }) {
  return (
    <Section style={{ backgroundColor: "#eef8f9", borderRadius: "12px", margin: "0 0 20px", padding: "14px 16px" }}>
      {data.pickupLine ? <Text style={{ ...text, fontWeight: 700, margin: "0 0 6px" }}>{data.pickupLine}</Text> : null}
      <Text style={{ ...text, margin: 0 }}>
        <strong>{data.locationName}</strong>
        {data.locationAddress ? <><br />{data.locationAddress}</> : null}
      </Text>
      {data.pickupInstructions ? <Text style={{ ...muted, margin: "6px 0 0" }}>{data.pickupInstructions}</Text> : null}
      {data.cupName ? <Text style={{ ...muted, margin: "6px 0 0" }}>Name on the cup: {data.cupName}</Text> : null}
    </Section>
  );
}

function Items({ data }: { data: OrderEmailData }) {
  return (
    <Section>
      {data.items.map((item, index) => (
        <Row key={index} style={{ borderBottom: `1px solid ${LINE}` }}>
          <Column style={{ padding: "10px 0", verticalAlign: "top" }}>
            <Text style={{ ...text, fontWeight: 700, margin: 0 }}>
              {item.quantity}× {item.name}
            </Text>
            {item.details ? <Text style={{ ...muted, margin: "2px 0 0" }}>{item.details}</Text> : null}
            {item.specialInstructions ? <Text style={{ ...muted, fontStyle: "italic", margin: "2px 0 0" }}>“{item.specialInstructions}”</Text> : null}
            {item.rewardNotes.map((note) => (
              <Text key={note} style={{ ...muted, color: MAGENTA_DEEP, fontWeight: 700, margin: "2px 0 0" }}>
                Reward: {note}
              </Text>
            ))}
          </Column>
          <Column align="right" style={{ padding: "10px 0", verticalAlign: "top", width: "90px" }}>
            <Text style={{ ...text, fontWeight: 700, margin: 0 }}>{item.total}</Text>
          </Column>
        </Row>
      ))}
      <Section style={{ marginTop: "8px" }}>
        {data.breakdown.map((row) => (
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
      {data.paymentMethod ? <Text style={{ ...muted, margin: "10px 0 0" }}>Paid with {data.paymentMethod}</Text> : null}
    </Section>
  );
}

function PointsLine({ data }: { data: OrderEmailData }) {
  if (!data.pointsLine) return null;
  return (
    <Section style={{ backgroundColor: "#fdf0f6", borderRadius: "12px", margin: "16px 0 0", padding: "12px 16px" }}>
      <Text style={{ ...text, margin: 0 }}>{data.pointsLine}</Text>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------

export function OrderReceiptEmail({ data }: { data: OrderEmailData }) {
  return (
    <Layout preview={`Mahalo! Order ${data.orderNumber} is in. ${data.pickupLine ?? ""}`.trim()}>
      <Title>
        <span style={{ color: MAGENTA_DEEP }}>Mahalo!</span> Your order is in.
      </Title>
      <OrderNumber value={data.orderNumber} />
      <Pickup data={data} />
      <Items data={data} />
      <PointsLine data={data} />
      <Hr style={{ borderColor: LINE, margin: "24px 0" }} />
      <Text style={text}>We&apos;ll update your order page as the team works on it, and alert you when it&apos;s ready.</Text>
      <TrackButton href={data.trackUrl} />
    </Layout>
  );
}

export function OrderCancelledEmail({
  data,
  kind,
  reason,
  refund,
}: {
  data: OrderEmailData;
  kind: "cancelled" | "refunded";
  reason: string | null;
  refund: string | null;
}) {
  const title = kind === "cancelled" ? "Your order was cancelled" : "Your order was refunded";
  return (
    <Layout preview={`${title} · ${data.orderNumber}${refund ? ` · ${refund}` : ""}`}>
      <Title>{title}</Title>
      <OrderNumber value={data.orderNumber} />
      {reason ? (
        <Text style={text}>
          <strong>Why:</strong> {reason}
        </Text>
      ) : null}
      {refund ? (
        <Section style={{ backgroundColor: "#fdf0f6", borderRadius: "12px", margin: "0 0 20px", padding: "14px 16px" }}>
          <Text style={{ ...text, margin: 0 }}>{refund}</Text>
        </Section>
      ) : null}
      <Items data={data} />
      <Hr style={{ borderColor: LINE, margin: "24px 0" }} />
      <Text style={text}>
        We&apos;re sorry for the trouble. If you have questions, just ask us at {data.locationName}.
      </Text>
      <TrackButton href={data.trackUrl} label="View your order" />
    </Layout>
  );
}

export function OrderReadyEmail({ data }: { data: OrderEmailData }) {
  return (
    <Layout preview={`Order ${data.orderNumber} is ready at ${data.locationName}!`}>
      <Title>Your order is ready! 🎉</Title>
      <OrderNumber value={data.orderNumber} />
      <Pickup data={{ ...data, pickupLine: null }} />
      <Text style={text}>Come grab it while it&apos;s fresh. Mahalo!</Text>
      <TrackButton href={data.trackUrl} label="View your order" />
      <Text style={{ ...muted, margin: "20px 0 0" }}>
        You asked for an email when your order is ready. You can turn this off on your{" "}
        <Link href={data.trackUrl.replace(/\/orders\/.*$/, "/account")} style={{ color: TEAL_DEEP }}>
          account page
        </Link>
        .
      </Text>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Plain-text versions, from the same data.
// ---------------------------------------------------------------------------

function textItems(data: OrderEmailData): string {
  const lines = data.items.flatMap((item) => [
    `${item.quantity}x ${item.name}  ${item.total}`,
    ...(item.details ? [`   ${item.details}`] : []),
    ...(item.specialInstructions ? [`   "${item.specialInstructions}"`] : []),
    ...item.rewardNotes.map((note) => `   Reward: ${note}`),
  ]);
  const totals = data.breakdown.map((row) => `${row.label}: ${row.amount}`);
  return [...lines, "", ...totals, ...(data.paymentMethod ? [`Paid with ${data.paymentMethod}`] : [])].join("\n");
}

function textPickup(data: OrderEmailData): string {
  return [
    data.pickupLine,
    data.locationName,
    data.locationAddress,
    data.pickupInstructions,
    data.cupName ? `Name on the cup: ${data.cupName}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const textFooter = `--\n${BRAND.name} · ${CAFE_ADDRESS_ONE_LINE}\n${BRAND.taglines.primary}`;

export function orderReceiptText(data: OrderEmailData): string {
  return [
    `Mahalo! Your order is in.`,
    `Order ${data.orderNumber}`,
    "",
    textPickup(data),
    "",
    textItems(data),
    ...(data.pointsLine ? ["", data.pointsLine] : []),
    "",
    `Track your order: ${data.trackUrl}`,
    "",
    textFooter,
  ].join("\n");
}

export function orderCancelledText(
  data: OrderEmailData,
  kind: "cancelled" | "refunded",
  reason: string | null,
  refund: string | null,
): string {
  return [
    kind === "cancelled" ? "Your order was cancelled" : "Your order was refunded",
    `Order ${data.orderNumber}`,
    "",
    ...(reason ? [`Why: ${reason}`] : []),
    ...(refund ? [refund] : []),
    "",
    textItems(data),
    "",
    `View your order: ${data.trackUrl}`,
    "",
    textFooter,
  ].join("\n");
}

export function orderReadyText(data: OrderEmailData): string {
  return [
    "Your order is ready!",
    `Order ${data.orderNumber}`,
    "",
    textPickup({ ...data, pickupLine: null }),
    "",
    `View your order: ${data.trackUrl}`,
    "",
    "You asked for an email when your order is ready; turn it off on your account page.",
    "",
    textFooter,
  ].join("\n");
}

import { Body, Button, Container, Head, Html, Preview, Section, Text } from "react-email";
import type { CSSProperties, ReactNode } from "react";

import { BRAND, CAFE_ADDRESS_ONE_LINE } from "@/lib/brand";

/**
 * The branded frame every email shares: the lowercase wordmark on a deep-teal
 * header (logo placeholder until artwork arrives), deep magenta accents,
 * near-black text. All AA on white.
 */
export const TEAL_DEEP = "#0E7C86";
export const MAGENTA_DEEP = "#B81C74";
export const INK = "#1a1a1a";
export const MUTED = "#5b5b5b";
export const LINE = "#e7e2dc";
export const FONT = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const HEADING_FONT = "'Baloo 2', 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";

export const text: CSSProperties = { color: INK, fontSize: "15px", lineHeight: "22px", margin: "0 0 12px" };
export const muted: CSSProperties = { ...text, color: MUTED, fontSize: "13px", lineHeight: "19px" };

export const ORDER_FOOTER = "You're getting this email about an order you placed with us. Receipts and refund updates are always sent.";

export function Layout({ preview, children, footer = ORDER_FOOTER }: { preview: string; children: ReactNode; footer?: string }) {
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
            <Text style={{ ...muted, margin: 0 }}>{footer}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={{ color: INK, fontFamily: HEADING_FONT, fontSize: "26px", fontWeight: 800, lineHeight: "32px", margin: "0 0 8px" }}>{children}</Text>;
}

export function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <Button
      href={href}
      style={{ backgroundColor: TEAL_DEEP, borderRadius: "999px", color: "#ffffff", display: "inline-block", fontSize: "15px", fontWeight: 700, padding: "12px 22px", textDecoration: "none" }}
    >
      {label}
    </Button>
  );
}

/** A soft panel for the one thing the reader must not miss. */
export function Panel({ children, tone = "teal" }: { children: ReactNode; tone?: "teal" | "pink" }) {
  return (
    <Section style={{ backgroundColor: tone === "teal" ? "#eef8f9" : "#fdf0f6", borderRadius: "12px", margin: "0 0 20px", padding: "14px 16px" }}>
      {children}
    </Section>
  );
}

export const textFooter = `--\n${BRAND.name} · ${CAFE_ADDRESS_ONE_LINE}\n${BRAND.taglines.primary}`;

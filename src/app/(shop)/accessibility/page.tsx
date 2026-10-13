import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { getSiteContent } from "@/lib/content/queries";
import { paragraphs } from "@/lib/content/registry";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "How the Drincup Cafe app works for everyone, and how to tell us if something gets in your way.",
  alternates: { canonical: "/accessibility" },
};

/** The accessibility statement, edited in Admin → Pages & contact. */
export default async function AccessibilityPage() {
  const { accessibility, contact_email, contact_phone } = await getSiteContent();
  return (
    <PageShell title="Accessibility">
      <div className="space-y-4 text-base leading-relaxed" data-testid="policy-text">
        {paragraphs(accessibility).map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
      </div>
      {contact_email || contact_phone ? (
        <p className="mt-6 rounded-2xl bg-brand-teal-soft p-4 text-base">
          Reach us{" "}
          {contact_email ? (
            <>
              at{" "}
              <a href={`mailto:${contact_email}`} className="font-semibold text-brand-teal-deep underline underline-offset-2">
                {contact_email}
              </a>
            </>
          ) : null}
          {contact_email && contact_phone ? " or " : null}
          {contact_phone ? (
            <>
              on{" "}
              <a href={`tel:${contact_phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-brand-teal-deep underline underline-offset-2">
                {contact_phone}
              </a>
            </>
          ) : null}
          .
        </p>
      ) : (
        <p className="mt-6 text-base">
          Our contact details are on the{" "}
          <Link href="/about" className="font-semibold text-brand-teal-deep underline underline-offset-2">
            About page
          </Link>
          .
        </p>
      )}
    </PageShell>
  );
}

import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { getSiteContent } from "@/lib/content/queries";
import { paragraphs } from "@/lib/content/registry";

export const metadata: Metadata = { title: "Terms" };

export default async function TermsPage() {
  const { terms, refund_policy } = await getSiteContent();
  return (
    <PageShell title="Terms" backHref="/account" backLabel="Account">
      <div className="space-y-4 text-base leading-relaxed" data-testid="policy-text">
        {paragraphs(terms).map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
      </div>
      {refund_policy ? (
        <section aria-labelledby="refunds-heading" className="mt-8">
          <h2 id="refunds-heading" className="text-lg font-bold">
            Refunds and cancellations
          </h2>
          <div className="mt-2 space-y-3 text-base leading-relaxed">
            {paragraphs(refund_policy).map((p, i) => (
              <p key={i} className="whitespace-pre-line">
                {p}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </PageShell>
  );
}

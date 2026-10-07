import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { getSiteContent } from "@/lib/content/queries";
import { paragraphs } from "@/lib/content/registry";

export const metadata: Metadata = { title: "Privacy policy" };

export default async function PrivacyPage() {
  const { privacy_policy } = await getSiteContent();
  return (
    <PageShell title="Privacy policy" backHref="/account" backLabel="Account">
      <div className="space-y-4 text-base leading-relaxed" data-testid="policy-text">
        {paragraphs(privacy_policy).map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {p}
          </p>
        ))}
      </div>
    </PageShell>
  );
}

import { AtSign, Mail, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Swirl } from "@/components/brand/logo";
import { PageShell } from "@/components/page-shell";
import { BRAND, CAFE_ADDRESS } from "@/lib/brand";
import { getSiteContent } from "@/lib/content/queries";
import { paragraphs } from "@/lib/content/registry";

export const metadata: Metadata = { title: "About" };

/** The cafe's story and how to reach it, as the owner wrote them on /admin/content. */
export default async function AboutPage() {
  const content = await getSiteContent();
  const contact = [
    content.contact_phone ? { href: `tel:${content.contact_phone.replace(/\D/g, "")}`, label: content.contact_phone, Icon: Phone } : null,
    content.contact_email ? { href: `mailto:${content.contact_email}`, label: content.contact_email, Icon: Mail } : null,
    content.instagram_url ? { href: content.instagram_url, label: "Instagram", Icon: AtSign } : null,
    content.facebook_url ? { href: content.facebook_url, label: "Facebook", Icon: AtSign } : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);

  return (
    <PageShell title={`About ${BRAND.name}`}>
      <p className="font-heading text-xl font-bold text-brand-teal-deep">{BRAND.taglines.primary}</p>
      <Swirl className="mt-1 h-5 text-brand-magenta" />
      <div className="mt-4 space-y-4 text-base leading-relaxed" data-testid="about-copy">
        {paragraphs(content.about).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      <section aria-labelledby="visit-heading" className="mt-8 rounded-3xl border bg-card p-5">
        <h2 id="visit-heading" className="text-lg font-bold">
          Visit us
        </h2>
        <p className="mt-1 text-sm">
          {CAFE_ADDRESS.line1}, {CAFE_ADDRESS.line2}
          <br />
          {CAFE_ADDRESS.city}, {CAFE_ADDRESS.state} {CAFE_ADDRESS.postalCode}
        </p>
        {contact.length ? (
          <ul className="mt-3 space-y-1" aria-label="Contact">
            {contact.map(({ href, label, Icon }) => (
              <li key={href}>
                <a href={href} className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg font-semibold text-brand-teal-deep hover:underline" {...(href.startsWith("https") ? { target: "_blank", rel: "noreferrer" } : {})}>
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="mt-6 flex flex-wrap gap-4 text-sm">
        <Link href="/privacy" className="font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
          Privacy policy
        </Link>
        <Link href="/terms" className="font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
          Terms
        </Link>
      </p>
    </PageShell>
  );
}

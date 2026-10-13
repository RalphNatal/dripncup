import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo, Swirl } from "@/components/brand/logo";
import { SkipLink } from "@/components/skip-link";
import { BRAND } from "@/lib/brand";
import { getLogoUrl } from "@/lib/content/queries";

// Nothing here for search engines.
export const metadata: Metadata = { robots: { index: false, follow: true } };

/** Shared frame for sign-in, sign-up and password recovery. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const logoUrl = await getLogoUrl();
  return (
    <>
      <SkipLink />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col bg-brand-wash px-4 pt-safe pb-10 outline-none">
        <div className="mx-auto w-full max-w-md pt-8">
          <Link href="/" aria-label={`${BRAND.name} home`} className="focus-ring inline-block rounded-md">
            <Logo size="md" src={logoUrl} />
          </Link>
          <Swirl className="mt-2 h-5 text-brand-magenta" />
          <div className="mt-6 rounded-3xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">{children}</div>
        </div>
      </main>
    </>
  );
}

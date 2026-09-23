import Link from "next/link";
import type { ReactNode } from "react";

import { Logo, Swirl } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";

/** Shared frame for sign-in, sign-up and password recovery. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col bg-brand-wash px-4 pt-safe pb-10">
      <div className="mx-auto w-full max-w-md pt-8">
        <Link href="/" aria-label={`${BRAND.name} home`} className="inline-block rounded-md">
          <Logo size="md" />
        </Link>
        <Swirl className="mt-2 h-5 text-brand-magenta" />
        <div className="mt-6 rounded-3xl bg-card p-6 shadow-sm ring-1 ring-foreground/5">{children}</div>
      </div>
    </main>
  );
}

import { Gift } from "lucide-react";
import type { Metadata } from "next";

import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: BRAND.loyaltyProgramName };

/** Placeholder: earning, redemption and the member QR arrive with Rewards (Phase 7). */
export default async function RewardsPage() {
  const profile = await requireProfile("/rewards");

  return (
    <PageShell title={BRAND.loyaltyProgramName}>
      <div className="rounded-3xl border border-brand-pink/60 bg-brand-pink-soft p-6 text-center">
        <Gift className="mx-auto size-10 text-brand-magenta-deep" aria-hidden="true" />
        <p className="mt-3 text-4xl font-extrabold tabular">{profile.loyalty_points}</p>
        <p className="text-sm font-medium text-foreground/80">points</p>
        <p className="mt-4 text-base">Rewards are almost ready. Soon you&apos;ll earn points on every order.</p>
      </div>
    </PageShell>
  );
}

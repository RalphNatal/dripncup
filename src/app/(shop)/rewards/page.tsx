import { Gift, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { ActivityList } from "@/components/rewards/activity-list";
import { MemberCard } from "@/components/rewards/member-card";
import { RewardsSummary } from "@/components/rewards/rewards-summary";
import { TierList } from "@/components/rewards/tier-list";
import { getCurrentProfile } from "@/lib/auth/dal";
import { BRAND } from "@/lib/brand";
import { howItWorks, type RewardsSettings } from "@/lib/rewards/model";
import { getMyRewards, getRewardsSettings, getRewardTiers, listPointsActivity } from "@/lib/rewards/queries";

export const metadata: Metadata = { title: BRAND.loyaltyProgramName };

/**
 * Overflow Rewards. Signed in: balance and progress, every tier, the member
 * QR, the activity log and how it works. Guests see the programme and an
 * invitation to join. Every number on the page comes from the ledger or the
 * settings.
 */
export default async function RewardsPage() {
  const profile = await getCurrentProfile();
  if (!profile) return <GuestRewards />;

  const [mine, activity] = await Promise.all([getMyRewards(), listPointsActivity()]);
  if (!mine) return <GuestRewards />;

  return (
    <PageShell title={mine.settings.programName}>
      <div className="space-y-5">
        <section aria-labelledby="balance-heading" className="rounded-3xl border border-brand-pink/60 bg-brand-pink-soft p-5">
          <h2 id="balance-heading" className="flex items-center gap-2 text-sm font-semibold tracking-wide text-brand-magenta-deep uppercase">
            <Sparkles className="size-4" aria-hidden="true" />
            Your balance
          </h2>
          <div className="mt-2">
            <RewardsSummary balance={mine.balance} progress={mine.progress} heldPoints={mine.heldPoints} />
          </div>
          <Link
            href="/menu"
            className="focus-ring mt-4 inline-flex min-h-11 items-center rounded-full bg-brand-magenta-deep px-5 text-sm font-bold text-white hover:bg-brand-magenta-deep/90"
          >
            Order and earn
          </Link>
        </section>

        <section aria-labelledby="tiers-heading">
          <h2 id="tiers-heading" className="mb-2 text-lg font-bold">
            Rewards
          </h2>
          <TierList tiers={mine.tiers} balance={mine.balance} />
          <p className="mt-2 text-sm text-muted-foreground">Choose a reward on the checkout page when you order.</p>
        </section>

        <MemberCard code={mine.memberCode} programName={mine.settings.programName} />

        <section aria-labelledby="activity-heading" className="rounded-3xl border bg-card p-5">
          <h2 id="activity-heading" className="text-lg font-bold">
            Activity
          </h2>
          <div className="mt-2">
            <ActivityList initial={activity.entries} initialCursor={activity.nextCursor} />
          </div>
        </section>

        <HowItWorks settings={mine.settings} />
      </div>
    </PageShell>
  );
}

async function GuestRewards() {
  const [settings, tiers] = await Promise.all([getRewardsSettings(), getRewardTiers()]);
  return (
    <PageShell title={settings.programName}>
      <div className="space-y-5">
        <section className="rounded-3xl border border-brand-pink/60 bg-brand-pink-soft p-6 text-center">
          <Gift className="mx-auto size-10 text-brand-magenta-deep" aria-hidden="true" />
          <h2 className="mt-3 text-2xl font-extrabold text-balance">Every cup fills yours up.</h2>
          <p className="mt-2 text-base">
            Join {settings.programName} to earn points on every order and trade them for free add-ons, drinks and more.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Link
              href="/sign-up?next=/rewards"
              className="focus-ring inline-flex min-h-12 items-center justify-center rounded-full bg-brand-magenta-deep px-6 font-bold text-white hover:bg-brand-magenta-deep/90"
            >
              Join for free
            </Link>
            <Link
              href="/sign-in?next=/rewards"
              className="focus-ring inline-flex min-h-12 items-center justify-center rounded-full border bg-card px-6 font-bold hover:bg-muted"
            >
              Sign in
            </Link>
          </div>
        </section>

        <section aria-labelledby="guest-tiers-heading">
          <h2 id="guest-tiers-heading" className="mb-2 text-lg font-bold">
            What you can get
          </h2>
          <TierList tiers={tiers} balance={null} />
        </section>

        <HowItWorks settings={settings} />
      </div>
    </PageShell>
  );
}

function HowItWorks({ settings }: { settings: RewardsSettings }) {
  return (
    <section aria-labelledby="how-heading" className="rounded-3xl border bg-card p-5" data-testid="how-it-works">
      <h2 id="how-heading" className="text-lg font-bold">
        How it works
      </h2>
      <dl className="mt-3 space-y-3">
        {howItWorks(settings).map((step) => (
          <div key={step.title}>
            <dt className="font-semibold">{step.title}</dt>
            <dd className="text-sm text-muted-foreground">{step.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

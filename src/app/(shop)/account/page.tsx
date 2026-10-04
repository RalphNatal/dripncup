import { ChevronRight, Gift, Heart, KeyRound, LayoutDashboard, Store, UserX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ProfileForm } from "@/components/account/profile-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PageShell } from "@/components/page-shell";
import { MemberCard } from "@/components/rewards/member-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireProfile } from "@/lib/auth/dal";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { BRAND } from "@/lib/brand";
import { formatPoints } from "@/lib/rewards/model";

export const metadata: Metadata = { title: "Account" };

function LinkRow({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium hover:bg-muted"
    >
      <span className="text-brand-teal-deep [&_svg]:size-5">{icon}</span>
      <span className="flex-1">{children}</span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

export default async function AccountPage() {
  const profile = await requireProfile("/account");
  const prefs = (profile.notification_prefs ?? {}) as { order_ready_email?: boolean };
  const isStaff = profile.role === "staff" || profile.role === "admin";

  return (
    <PageShell title="Account">
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{profile.full_name ?? "Drincup guest"}</p>
              <p className="truncate text-sm text-muted-foreground">{profile.email}</p>
            </div>
            {profile.role !== "customer" ? (
              <Badge className="shrink-0 bg-brand-magenta-deep text-white hover:bg-brand-magenta-deep">
                {ROLE_LABELS[profile.role]}
              </Badge>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <nav aria-label="Account shortcuts" className="mt-4 space-y-1">
        {isStaff ? (
          <LinkRow href="/staff" icon={<Store aria-hidden="true" />}>
            Staff dashboard
          </LinkRow>
        ) : null}
        {profile.role === "admin" ? (
          <LinkRow href="/admin" icon={<LayoutDashboard aria-hidden="true" />}>
            Admin dashboard
          </LinkRow>
        ) : null}
        <LinkRow href="/rewards" icon={<Gift aria-hidden="true" />}>
          {BRAND.loyaltyProgramName} · <span className="tabular">{formatPoints(profile.loyalty_points)}</span>
        </LinkRow>
        <LinkRow href="/account/favorites" icon={<Heart aria-hidden="true" />}>
          Favorites
        </LinkRow>
        <LinkRow href="/account/password" icon={<KeyRound aria-hidden="true" />}>
          Change password
        </LinkRow>
      </nav>

      <div className="mt-6">
        <MemberCard code={profile.member_code} programName={BRAND.loyaltyProgramName} />
      </div>

      <section aria-labelledby="profile-heading" className="mt-8">
        <h2 id="profile-heading" className="sr-only">
          Profile and preferences
        </h2>
        <ProfileForm
          defaults={{
            fullName: profile.full_name ?? "",
            firstName: profile.first_name ?? "",
            phone: profile.phone ?? "",
            marketingOptIn: profile.marketing_opt_in,
            smsOptIn: profile.sms_opt_in,
            // Off unless the customer turns it on; the in-app alert covers it.
            orderReadyEmail: prefs.order_ready_email === true,
          }}
        />
      </section>

      <div className="mt-10">
        <SignOutButton />
      </div>

      <div className="mt-6 border-t pt-4">
        <Link
          href="/account/delete"
          className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium text-destructive hover:bg-destructive/5"
        >
          <UserX className="size-5" aria-hidden="true" />
          <span className="flex-1">Delete my account</span>
          <ChevronRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </PageShell>
  );
}

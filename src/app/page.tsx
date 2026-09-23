import { Clock, MapPin } from "lucide-react";
import { Suspense } from "react";

import { AccountLink, AccountLinkSkeleton } from "@/components/auth/account-link";
import { Logo, Swirl } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BRAND, CAFE_ADDRESS, CAFE_ADDRESS_ONE_LINE } from "@/lib/brand";

/**
 * Placeholder home screen for Phase 1.
 *
 * Phase 3 replaces this with the real Home tab (greeting, rewards balance,
 * active order card, seasonal banner). It stays deliberately small, but it is
 * built from the brand tokens so the foundation is visibly working.
 */
export default function HomePage() {
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    CAFE_ADDRESS_ONE_LINE,
  )}`;

  return (
    <main className="flex flex-1 flex-col">
      <section className="bg-brand-wash px-4 pt-safe pb-10">
        <div className="mx-auto flex w-full max-w-md justify-end pt-4">
          <Suspense fallback={<AccountLinkSkeleton />}>
            <AccountLink />
          </Suspense>
        </div>
        <div className="mx-auto w-full max-w-md pt-4">
          <Logo size="lg" />
          <Swirl className="mt-3 h-7 text-brand-magenta" />

          <h1 className="mt-6 text-3xl font-extrabold text-balance">{BRAND.taglines.primary}</h1>
          <p className="mt-2 text-base text-muted-foreground">{BRAND.taglines.secondary}</p>

          <Badge className="mt-6 bg-brand-teal-deep text-white hover:bg-brand-teal-deep">
            Order ahead — coming soon
          </Badge>
        </div>
      </section>

      <section className="px-4 py-8">
        <div className="mx-auto w-full max-w-md space-y-4">
          <Card className="rounded-2xl">
            <CardContent className="flex gap-3 p-5">
              <MapPin className="mt-0.5 size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Find us</h2>
                <address className="mt-1 text-sm not-italic text-muted-foreground">
                  {CAFE_ADDRESS.line1}, {CAFE_ADDRESS.line2}
                  <br />
                  {CAFE_ADDRESS.city}, {CAFE_ADDRESS.state} {CAFE_ADDRESS.postalCode}
                </address>
                <Button asChild variant="outline" size="sm" className="mt-3 min-h-11 rounded-full">
                  <a href={mapsHref} target="_blank" rel="noreferrer noopener">
                    Get directions
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="flex gap-3 p-5">
              <Clock className="mt-0.5 size-5 shrink-0 text-brand-magenta-deep" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">Hours</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Hours are managed in the admin dashboard and shown here once they have been
                  confirmed with the cafe.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-brand-pink/60 bg-brand-pink-soft">
            <CardContent className="p-5">
              <h2 className="text-lg font-semibold">{BRAND.loyaltyProgramName}</h2>
              <p className="mt-1 text-sm text-foreground/80">
                Earn points on every order and watch your cup overflow.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="mt-auto bg-brand-ink px-4 py-8 text-white">
        <div className="mx-auto w-full max-w-md">
          <p className="font-heading text-xl font-bold lowercase">{BRAND.wordmark}</p>
          <p className="mt-2 text-sm text-white/70">{BRAND.taglines.secondary}</p>
        </div>
      </footer>
    </main>
  );
}

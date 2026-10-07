import { CalendarClock, ClipboardList, CreditCard, PartyPopper, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Swirl } from "@/components/brand/logo";
import { CateringRequestForm } from "@/components/catering/request-form";
import { getCurrentProfile } from "@/lib/auth/dal";
import { getCateringMenu } from "@/lib/catering/queries";
import { earliestEventAt } from "@/lib/catering/rules";
import { getCateringSettings } from "@/lib/catering/settings";
import { appNow } from "@/lib/clock";
import { formatCents } from "@/lib/money";
import { cafeDateKey, cafeTimeKey, formatCafeDate, formatCafeTimeOfDay } from "@/lib/time";

export const metadata: Metadata = {
  title: "Catering",
  description: "Drincup Cafe catering for offices, parties and celebrations across Oʻahu: espresso, tropical refreshers, shave ice and custom signature drinks.",
};

/**
 * Catering: what we offer and how it works, for everyone; the request form
 * for signed-in customers (guests are invited to sign in, and come back
 * here afterwards).
 */
export default async function CateringPage() {
  const [profile, settings, menu, now] = await Promise.all([getCurrentProfile(), getCateringSettings(), getCateringMenu(), appNow()]);
  const earliest = earliestEventAt(now, settings.minLeadTimeHours);
  const leadDays = settings.minLeadTimeHours % 24 === 0 ? `${settings.minLeadTimeHours / 24} days` : `${settings.minLeadTimeHours} hours`;

  const steps = [
    { icon: ClipboardList, title: "Tell us about your event", body: `The date, how many guests, the drinks you'd like. We need at least ${leadDays}' notice.` },
    { icon: CreditCard, title: "Get your quote", body: "We send an itemised quote, usually within a day or two. Ask for changes any time before you pay." },
    { icon: PartyPopper, title: "Pay and relax", body: `Pay online to confirm, at least ${settings.paymentDeadlineHours} hours before your event. We'll remind you the day before.` },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] bg-brand-wash px-6 pt-7 pb-8">
        <p className="text-base font-semibold text-brand-magenta-deep">Catering</p>
        <h1 className="mt-1 text-4xl font-extrabold text-balance">Good drinks for your whole crew</h1>
        <Swirl className="mt-2 h-6 text-brand-magenta" />
        <p className="mt-3 text-base text-foreground/80">
          Office mornings, birthdays, launches and lūʻau: espresso classics, tropical refreshers and shave ice, made fresh for your
          event. Want something special? We&apos;ll create a signature drink just for you.
        </p>
        <ul className="mt-5 space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <CalendarClock className="size-4 text-brand-teal-deep" aria-hidden="true" />
            At least {leadDays}&apos; notice
          </li>
          <li className="flex items-center gap-2">
            <Truck className="size-4 text-brand-teal-deep" aria-hidden="true" />
            {settings.deliveryOffered
              ? `Pickup at the cafe, or delivery across Oʻahu (from ${formatCents(settings.deliveryFeeCents)})`
              : "Pickup at the cafe"}
          </li>
        </ul>
      </section>

      <section aria-labelledby="catering-how">
        <h2 id="catering-how" className="text-xl font-bold">
          How it works
        </h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-3">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="rounded-3xl border bg-card p-4">
              <Icon className="size-6 text-brand-teal-deep" aria-hidden="true" />
              <p className="mt-2 font-bold">
                {index + 1}. {title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-muted-foreground">{settings.refundPolicy}</p>
      </section>

      {profile ? (
        <CateringRequestForm
          menu={menu}
          leadTimeHours={settings.minLeadTimeHours}
          earliest={{
            iso: earliest.toISOString(),
            date: cafeDateKey(earliest),
            time: cafeTimeKey(earliest),
            label: `${formatCafeDate(earliest)} at ${formatCafeTimeOfDay(earliest)}`,
          }}
          delivery={{ offered: settings.deliveryOffered, zipCodes: settings.deliveryZipCodes }}
          defaults={{ name: profile.full_name ?? "", email: profile.email ?? "", phone: profile.phone ?? "" }}
        />
      ) : (
        <section className="rounded-3xl border-2 border-dashed p-6 text-center" data-testid="catering-sign-in">
          <h2 className="text-xl font-bold">Ready to plan your event?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to send a request. We&apos;ll keep your quote and updates in your account.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link
              href="/sign-in?next=/catering"
              className="focus-ring inline-flex min-h-12 items-center rounded-full bg-brand-teal-deep px-6 font-semibold text-white hover:bg-brand-teal-deep/90"
            >
              Sign in to request
            </Link>
            <Link href="/sign-up?next=/catering" className="focus-ring inline-flex min-h-12 items-center rounded-full border px-6 font-semibold hover:bg-muted">
              Create an account
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

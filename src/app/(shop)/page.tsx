import { ArrowRight, CalendarDays, ChefHat, Gift, MapPin } from "lucide-react";
import Link from "next/link";

import { AccountDeletedNotice } from "@/components/account/account-deleted-notice";
import { Swirl } from "@/components/brand/logo";
import { EventCard } from "@/components/events/event-card";
import { FavoritesRow } from "@/components/favorites/favorites-list";
import { StatusDot } from "@/components/locations/status-dot";
import { CollectionBanner } from "@/components/menu/banners";
import { ActiveOrderCards, PastOrderRow } from "@/components/orders/order-lists";
import { RewardsSummary } from "@/components/rewards/rewards-summary";
import { getCurrentProfile } from "@/lib/auth/dal";
import { BRAND } from "@/lib/brand";
import { listPublicEvents } from "@/lib/events/queries";
import { listFavorites } from "@/lib/favorites/queries";
import { getStorefront } from "@/lib/locations/storefront";
import { getMenuPageData } from "@/lib/menu/queries";
import { listActiveOrders, listPastOrders } from "@/lib/orders/queries";
import { getMyRewards } from "@/lib/rewards/queries";
import { firstParam, type SearchParams } from "@/lib/search-params";

/**
 * Home tab: greeting with the Overflow Rewards balance, live cards for
 * orders on their way, the customer's favourites, "Order again" from recent
 * orders, the current seasonal collection, the pickup location, upcoming
 * pop-ups and catering.
 */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const accountDeleted = firstParam((await searchParams).account) === "deleted";
  const [{ selected }, profile, menuData, events] = await Promise.all([
    getStorefront(),
    getCurrentProfile(),
    getMenuPageData(),
    listPublicEvents({ limit: 3 }),
  ]);
  const collection = menuData?.menu.collection ?? null;
  const greeting = profile?.first_name ? `Aloha, ${profile.first_name}!` : "Aloha!";
  const [active, recent, favorites, rewards] = profile
    ? await Promise.all([listActiveOrders(), listPastOrders(null, 3), listFavorites(), getMyRewards()])
    : [[], null, null, null];

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {accountDeleted ? <AccountDeletedNotice /> : null}

      <section className="relative overflow-hidden rounded-[2rem] bg-brand-wash px-6 pt-7 pb-8">
        <p className="text-base font-semibold text-brand-magenta-deep">{greeting}</p>
        <h1 className="mt-1 text-4xl font-extrabold text-balance">{BRAND.taglines.primary}</h1>
        <Swirl className="mt-2 h-6 text-brand-magenta" />
        <p className="mt-3 text-base text-foreground/80">{BRAND.taglines.secondary}</p>
        <Link
          href="/menu"
          className="focus-ring mt-6 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-teal-deep px-6 text-base font-semibold text-white hover:bg-brand-teal-deep/90"
        >
          Start an order
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>

        {rewards ? (
          <Link
            href="/rewards"
            className="focus-ring mt-6 block rounded-3xl border border-brand-pink/60 bg-brand-pink-soft/90 p-4 hover:bg-brand-pink-soft"
            data-testid="home-rewards"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-brand-magenta-deep">
              <Gift className="size-4" aria-hidden="true" />
              {rewards.settings.programName}
            </p>
            <div className="mt-1">
              <RewardsSummary balance={rewards.balance} progress={rewards.progress} compact />
            </div>
          </Link>
        ) : (
          <p className="mt-6 flex items-center gap-2 text-sm" data-testid="home-rewards">
            <Gift className="size-4 text-brand-magenta-deep" aria-hidden="true" />
            <span>
              <Link href="/sign-up" className="focus-ring rounded font-semibold text-brand-magenta-deep underline underline-offset-2">
                Join {BRAND.loyaltyProgramName}
              </Link>{" "}
              and earn points on every order.
            </span>
          </p>
        )}
      </section>

      {profile ? <ActiveOrderCards userId={profile.id} initial={active} /> : null}

      {favorites ? <FavoritesRow list={favorites} /> : null}

      {recent && recent.orders.length > 0 ? (
        <section aria-labelledby="home-order-again">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="home-order-again" className="text-lg font-bold">
              Order again
            </h2>
            <Link href="/orders" className="focus-ring rounded text-sm font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
              All orders
            </Link>
          </div>
          <ul className="mt-2 space-y-3">
            {recent.orders.map((order) => (
              <PastOrderRow key={order.id} order={order} />
            ))}
          </ul>
        </section>
      ) : null}

      {collection ? <CollectionBanner collection={collection} /> : null}

      {selected ? (
        <section aria-labelledby="home-pickup" className="rounded-3xl border bg-card p-5">
          <h2 id="home-pickup" className="flex items-center gap-2 text-lg font-bold">
            <MapPin className="size-5 text-brand-teal-deep" aria-hidden="true" />
            Pickup at {selected.name}
          </h2>
          <p className="mt-2 flex items-center gap-2 text-sm font-medium">
            <StatusDot kind={selected.status.kind} />
            {selected.status.label}
            {selected.status.detail && selected.status.kind === "open" ? ` · ${selected.status.detail}` : ""}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected.type === "event" ? selected.todaysHours.hours : `Today: ${selected.todaysHours.hours}`}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="home-events" className="space-y-3" data-testid="home-events">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="home-events" className="flex items-center gap-2 text-lg font-bold">
            <CalendarDays className="size-5 text-brand-teal-deep" aria-hidden="true" />
            Upcoming pop-ups
          </h2>
          <Link href="/events" className="focus-ring rounded text-sm font-semibold text-brand-teal-deep underline-offset-2 hover:underline">
            All events
          </Link>
        </div>
        {events.length > 0 ? (
          events.map((event) => <EventCard key={event.id} event={event} compact />)
        ) : (
          <p className="rounded-3xl border border-dashed p-5 text-sm text-muted-foreground">No pop-ups on the calendar right now. Check back soon!</p>
        )}
      </section>

      <Link
        href="/catering"
        className="focus-ring flex items-center gap-4 rounded-3xl border bg-card p-5 hover:border-brand-teal-deep"
      >
        <ChefHat className="size-8 shrink-0 text-brand-magenta-deep" aria-hidden="true" />
        <span>
          <span className="block text-lg font-bold">Catering for your event</span>
          <span className="block text-sm text-muted-foreground">Offices, parties and celebrations across Oʻahu, with custom signature drinks.</span>
        </span>
        <ArrowRight className="ml-auto size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </div>
  );
}

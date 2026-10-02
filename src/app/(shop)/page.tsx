import { ArrowRight, Gift, MapPin } from "lucide-react";
import Link from "next/link";

import { AccountDeletedNotice } from "@/components/account/account-deleted-notice";
import { Swirl } from "@/components/brand/logo";
import { FavoritesRow } from "@/components/favorites/favorites-list";
import { StatusDot } from "@/components/locations/status-dot";
import { ActiveOrderCards, PastOrderRow } from "@/components/orders/order-lists";
import { getCurrentProfile } from "@/lib/auth/dal";
import { BRAND } from "@/lib/brand";
import { listFavorites } from "@/lib/favorites/queries";
import { getStorefront } from "@/lib/locations/storefront";
import { listActiveOrders, listPastOrders } from "@/lib/orders/queries";
import { firstParam, type SearchParams } from "@/lib/search-params";

/**
 * Home tab: greeting, live cards for orders on their way, the customer's
 * favourites, "Order again" from recent orders, and the pickup location.
 * Rewards and upcoming pop-ups arrive in Phases 7 and 8.
 */
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const accountDeleted = firstParam((await searchParams).account) === "deleted";
  const [{ selected }, profile] = await Promise.all([getStorefront(), getCurrentProfile()]);
  const greeting = profile?.first_name ? `Aloha, ${profile.first_name}!` : "Aloha!";
  const [active, recent, favorites] = profile
    ? await Promise.all([listActiveOrders(), listPastOrders(null, 3), listFavorites()])
    : [[], null, null];

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

      <section aria-labelledby="home-rewards" className="rounded-3xl border border-brand-pink/60 bg-brand-pink-soft p-5">
        <h2 id="home-rewards" className="flex items-center gap-2 text-lg font-bold">
          <Gift className="size-5 text-brand-magenta-deep" aria-hidden="true" />
          {BRAND.loyaltyProgramName}
        </h2>
        <p className="mt-1 text-sm text-foreground/80">
          Earn points on every order and watch your cup overflow. Coming soon.
        </p>
      </section>
    </div>
  );
}

"use client";

/**
 * The five customer tabs: a bottom tab bar on phones, links in the header
 * from `md` up. One list, two presentations. Orders carries a live dot
 * while one of the customer's orders is on its way (useActiveOrders: the
 * same subscription the Home cards use).
 */
import { CircleUserRound, CupSoda, Gift, House, Receipt, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CUSTOMER_TABS } from "@/lib/brand";
import { useActiveOrders } from "@/lib/orders/live";
import { cn } from "@/lib/utils";

const ICONS: Record<(typeof CUSTOMER_TABS)[number]["href"], LucideIcon> = {
  "/": House,
  "/menu": CupSoda,
  "/rewards": Gift,
  "/orders": Receipt,
  "/account": CircleUserRound,
};

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** True while an order is between Placed and Ready. */
function useOrderInProgress(userId: string | null): { inProgress: boolean; ready: boolean } {
  const orders = useActiveOrders(userId);
  return { inProgress: orders.length > 0, ready: orders.some((o) => o.status === "ready") };
}

function OrderDot({ ready, className }: { ready: boolean; className?: string }) {
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="orders-dot"
        className={cn("size-2.5 rounded-full ring-2 ring-background", ready ? "bg-brand-magenta-deep" : "bg-brand-teal", className)}
      />
      <span className="sr-only">{ready ? " (order ready)" : " (order in progress)"}</span>
    </>
  );
}

export function BottomTabs({ userId }: { userId: string | null }) {
  const pathname = usePathname();
  const orders = useOrderInProgress(userId);

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
    >
      <ul className="mx-auto grid h-[var(--tabbar-h)] max-w-md grid-cols-5">
        {CUSTOMER_TABS.map(({ href, label }) => {
          const Icon = ICONS[href];
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring flex flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[0.7rem] font-semibold",
                  active ? "text-brand-teal-deep" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "relative flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-brand-teal-soft",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {href === "/orders" && orders.inProgress ? (
                    <OrderDot ready={orders.ready} className="absolute top-0 right-2.5" />
                  ) : null}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function DesktopNav({ userId, className }: { userId: string | null; className?: string }) {
  const pathname = usePathname();
  const orders = useOrderInProgress(userId);

  return (
    <nav aria-label="Main" className={className}>
      <ul className="flex items-center gap-1">
        {CUSTOMER_TABS.map(({ href, label }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold",
                  active ? "bg-brand-teal-soft text-brand-teal-deep" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {href === "/orders" && orders.inProgress ? <OrderDot ready={orders.ready} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

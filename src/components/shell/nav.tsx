"use client";

/**
 * The five customer tabs: a bottom tab bar on phones, links in the header
 * from `md` up. One list, two presentations.
 */
import { CircleUserRound, CupSoda, Gift, House, Receipt, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CUSTOMER_TABS } from "@/lib/brand";
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

export function BottomTabs() {
  const pathname = usePathname();

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
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-brand-teal-soft",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
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

export function DesktopNav({ className }: { className?: string }) {
  const pathname = usePathname();

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
                  "focus-ring inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold",
                  active ? "bg-brand-teal-soft text-brand-teal-deep" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

"use client";

/**
 * The admin frame: a sidebar from `lg` up, a top bar with a menu sheet on
 * phones. One list, two presentations. Sections that are not built yet
 * (Phase 9) are listed as "Coming soon", as plain text rather than links, so
 * nothing in the nav leads nowhere.
 */
import {
  BarChart3,
  CalendarDays,
  ChefHat,
  CupSoda,
  Gift,
  House,
  LayoutDashboard,
  MapPin,
  Menu,
  Percent,
  Settings,
  Sparkles,
  Undo2,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

type NavItem =
  | { kind: "link"; href: string; label: string; icon: LucideIcon; exact?: boolean; badge?: "catering" }
  | { kind: "soon"; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { kind: "link", href: "/admin", label: "Home", icon: LayoutDashboard, exact: true },
  { kind: "link", href: "/admin/catering", label: "Catering", icon: ChefHat, badge: "catering" },
  { kind: "link", href: "/admin/events", label: "Events", icon: CalendarDays },
  { kind: "link", href: "/admin/collections", label: "Collections", icon: Sparkles },
  { kind: "soon", label: "Menu", icon: CupSoda },
  { kind: "soon", label: "Locations", icon: MapPin },
  { kind: "soon", label: "Settings", icon: Settings },
  { kind: "soon", label: "Promotions", icon: Percent },
  { kind: "soon", label: "Rewards", icon: Gift },
  { kind: "soon", label: "Users", icon: Users },
  { kind: "soon", label: "Reports", icon: BarChart3 },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ newCatering, onNavigate }: { newCatering: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        if (item.kind === "soon") {
          return (
            <li key={item.label}>
              <span
                aria-disabled="true"
                className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground"
              >
                <Icon className="size-5" aria-hidden="true" />
                <span>{item.label}</span>
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">Coming soon</span>
              </span>
            </li>
          );
        }
        const active = isActive(pathname, item.href, item.exact);
        const badge = item.badge === "catering" && newCatering > 0 ? newCatering : null;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold",
                active ? "bg-brand-teal-soft text-brand-teal-deep" : "text-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {item.label}
              {badge ? (
                <span className="ml-auto rounded-full bg-brand-magenta-deep px-2 py-0.5 text-xs font-bold text-white" data-testid="admin-catering-badge">
                  {badge}
                  <span className="sr-only"> new</span>
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Wordmark() {
  return (
    <Link href="/admin" className="focus-ring inline-flex items-baseline gap-2 rounded-lg">
      <span className="font-heading text-2xl font-extrabold text-brand-teal-deep">{BRAND.wordmark}</span>
      <span className="text-sm font-semibold text-muted-foreground">admin</span>
    </Link>
  );
}

function Footer({ adminName }: { adminName: string }) {
  return (
    <div className="space-y-1 border-t pt-4 text-sm">
      <p className="text-muted-foreground">
        Signed in as <span className="font-semibold text-foreground">{adminName}</span>
      </p>
      <Link href="/" className="focus-ring -ml-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-brand-teal-deep hover:underline">
        <House className="size-4" aria-hidden="true" />
        Back to the app
      </Link>
      <Link href="/staff" className="focus-ring -ml-2 flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-brand-teal-deep hover:underline">
        <Undo2 className="size-4" aria-hidden="true" />
        Staff screen
      </Link>
    </div>
  );
}

export function AdminShell({ adminName, newCatering, children }: { adminName: string; newCatering: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a
        href="#admin-main"
        className="focus-ring sr-only z-50 rounded-full bg-brand-teal-deep px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Phones and tablets: a top bar and a menu sheet. */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 pt-safe backdrop-blur lg:hidden">
        <div className="flex h-14 items-center">
          <Wordmark />
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold"
          aria-label={newCatering > 0 ? `Admin menu, ${newCatering} new catering requests` : "Admin menu"}
        >
          <Menu className="size-5" aria-hidden="true" />
          Menu
          {newCatering > 0 ? <span className="size-2.5 rounded-full bg-brand-magenta-deep" aria-hidden="true" /> : null}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-80 max-w-[85vw] gap-0 p-0">
            <SheetHeader className="border-b p-4">
              <SheetTitle className="font-heading text-xl font-extrabold">Admin</SheetTitle>
              <SheetDescription className="sr-only">Admin sections</SheetDescription>
            </SheetHeader>
            <nav aria-label="Admin" className="flex flex-1 flex-col justify-between gap-6 overflow-y-auto p-3">
              <NavList newCatering={newCatering} onNavigate={() => setOpen(false)} />
              <Footer adminName={adminName} />
            </nav>
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop: a sidebar. */}
      <aside className="hidden border-r bg-card lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-6 overflow-y-auto p-4">
          <Wordmark />
          <nav aria-label="Admin" className="flex flex-1 flex-col justify-between gap-6">
            <NavList newCatering={newCatering} />
            <Footer adminName={adminName} />
          </nav>
        </div>
      </aside>

      <main id="admin-main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none md:px-8">
        {children}
      </main>
    </div>
  );
}

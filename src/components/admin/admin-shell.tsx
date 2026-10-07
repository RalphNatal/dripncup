"use client";

/**
 * The admin frame: a sidebar from `lg` up, a top bar with a menu sheet on
 * phones. One list, two presentations. Home carries the number of things
 * that need attention; Catering the new requests.
 */
import {
  BarChart3,
  CalendarDays,
  ChefHat,
  ClipboardCheck,
  CupSoda,
  FileText,
  Gift,
  History,
  House,
  LayoutDashboard,
  MapPin,
  Menu,
  Percent,
  Receipt,
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
  | { kind: "link"; href: string; label: string; icon: LucideIcon; exact?: boolean; badge?: "catering" | "attention" }
  | { kind: "heading"; label: string };

const NAV: NavItem[] = [
  { kind: "link", href: "/admin", label: "Home", icon: LayoutDashboard, exact: true, badge: "attention" },
  { kind: "link", href: "/admin/orders", label: "Orders", icon: Receipt },
  { kind: "link", href: "/admin/catering", label: "Catering", icon: ChefHat, badge: "catering" },
  { kind: "link", href: "/admin/menu", label: "Menu", icon: CupSoda },
  { kind: "link", href: "/admin/locations", label: "Locations", icon: MapPin },
  { kind: "link", href: "/admin/events", label: "Events", icon: CalendarDays },
  { kind: "link", href: "/admin/collections", label: "Collections", icon: Sparkles },
  { kind: "link", href: "/admin/promos", label: "Promotions", icon: Percent },
  { kind: "link", href: "/admin/rewards", label: "Rewards", icon: Gift },
  { kind: "link", href: "/admin/users", label: "Users", icon: Users },
  { kind: "link", href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { kind: "heading", label: "Setup" },
  { kind: "link", href: "/admin/settings", label: "Settings", icon: Settings },
  { kind: "link", href: "/admin/setup", label: "Setup checklist", icon: ClipboardCheck },
  { kind: "link", href: "/admin/content", label: "Pages & contact", icon: FileText },
  { kind: "link", href: "/admin/audit", label: "Audit log", icon: History },
];

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({ newCatering, attention, onNavigate }: { newCatering: number; attention: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-1">
      {NAV.map((item) => {
        if (item.kind === "heading") {
          return (
            <li key={item.label} className="px-3 pt-4 pb-1 text-xs font-bold tracking-wide text-muted-foreground uppercase">
              {item.label}
            </li>
          );
        }
        const Icon = item.icon;
        const active = isActive(pathname, item.href, item.exact);
        const count = item.badge === "catering" ? newCatering : item.badge === "attention" ? attention : 0;
        const badge = count > 0 ? count : null;
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
                <span
                  className="ml-auto rounded-full bg-brand-magenta-deep px-2 py-0.5 text-xs font-bold text-white"
                  data-testid={item.badge === "attention" ? "admin-attention-badge" : "admin-catering-badge"}
                >
                  {badge}
                  <span className="sr-only">{item.badge === "attention" ? " need attention" : " new"}</span>
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

export function AdminShell({
  adminName,
  newCatering,
  attention,
  children,
}: {
  adminName: string;
  newCatering: number;
  attention: number;
  children: ReactNode;
}) {
  // The attention count includes new catering, so it alone drives the dot.
  const waiting = attention;
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
          aria-label={waiting > 0 ? `Admin menu, ${attention} ${attention === 1 ? "thing needs" : "things need"} attention` : "Admin menu"}
        >
          <Menu className="size-5" aria-hidden="true" />
          Menu
          {waiting > 0 ? <span className="size-2.5 rounded-full bg-brand-magenta-deep" aria-hidden="true" /> : null}
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-80 max-w-[85vw] gap-0 p-0">
            <SheetHeader className="border-b p-4">
              <SheetTitle className="font-heading text-xl font-extrabold">Admin</SheetTitle>
              <SheetDescription className="sr-only">Admin sections</SheetDescription>
            </SheetHeader>
            <nav aria-label="Admin" className="flex flex-1 flex-col justify-between gap-6 overflow-y-auto p-3">
              <NavList newCatering={newCatering} attention={attention} onNavigate={() => setOpen(false)} />
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
            <NavList newCatering={newCatering} attention={attention} />
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

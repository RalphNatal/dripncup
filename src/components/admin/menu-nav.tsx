import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/menu", label: "Products" },
  { href: "/admin/menu/categories", label: "Categories" },
  { href: "/admin/menu/modifiers", label: "Modifiers" },
  { href: "/admin/menu/sold-out", label: "Sold out" },
  { href: "/admin/menu/import", label: "Import" },
] as const;

/** The Menu section's tabs (links, so each view has its own URL). */
export function MenuNav({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Menu sections" className="-mx-4 mb-6 overflow-x-auto px-4">
      <ul className="flex gap-2">
        {TABS.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.href === current ? "page" : undefined}
              className={cn(
                "focus-ring inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap",
                tab.href === current ? "border-brand-teal-deep bg-brand-teal-soft text-brand-teal-deep" : "hover:bg-muted",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

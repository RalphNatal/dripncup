import Link from "next/link";

import { Swirl } from "@/components/brand/logo";
import { BRAND } from "@/lib/brand";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/accessibility", label: "Accessibility" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const;

/**
 * The quiet links at the end of every customer page: the policies and the
 * accessibility statement, reachable by guests too (the Account page has
 * them for members). Outside <main>, so it is the page's contentinfo
 * landmark; it carries the clearance for the fixed bottom tab bar on phones.
 */
export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-tabbar text-sm text-muted-foreground md:pb-12">
      <div className="mt-12 border-t pt-6">
        <Swirl className="h-4 text-brand-pink" />
        <nav aria-label="Site" className="mt-2">
          <ul className="-mx-3 flex flex-wrap">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="focus-ring inline-flex min-h-11 items-center rounded-full px-3 hover:text-foreground hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="mt-1">
          © {BRAND.name} · {BRAND.taglines.primary}
        </p>
      </div>
    </footer>
  );
}

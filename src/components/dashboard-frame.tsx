import type { ReactNode } from "react";

import { ToasterNow } from "@/components/lazy-toaster";
import { SkipLink } from "@/components/skip-link";
import { cn } from "@/lib/utils";

/**
 * Plain frame for /staff and /admin. They are work tools on a counter tablet
 * or laptop, not part of the customer app, so they skip its tab bar and
 * location header.
 *
 * `bleed` (the staff screen) drops the padding: the queue fills the whole
 * viewport and pads itself, and its other screens (Start shift, notices)
 * bring their own.
 */
export function DashboardFrame({ children, bleed = false }: { children: ReactNode; bleed?: boolean }) {
  return (
    <>
      <SkipLink />
      <ToasterNow />
      <main id="main" tabIndex={-1} className={cn("flex flex-1 flex-col outline-none", bleed ? "" : "px-4 pt-safe pb-12")}>
        {bleed ? children : <div className="pt-4">{children}</div>}
      </main>
    </>
  );
}

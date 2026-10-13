import type { ReactNode } from "react";

import { SkipLink } from "@/components/skip-link";

/**
 * Plain frame for /staff and /admin. They are work tools on a counter tablet
 * or laptop, not part of the customer app, so they skip its tab bar and
 * location header.
 */
export function DashboardFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <SkipLink />
      <main id="main" tabIndex={-1} className="flex flex-1 flex-col px-4 pt-safe pb-12 outline-none">
        <div className="pt-4">{children}</div>
      </main>
    </>
  );
}

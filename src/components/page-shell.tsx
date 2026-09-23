import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Plain single-column frame for inner pages until the tab bar and app header
 * arrive with the Home tab (Phase 3).
 */
export function PageShell({
  title,
  backHref = "/",
  backLabel = "Home",
  children,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col px-4 pt-safe pb-12">
      <div className="mx-auto w-full max-w-md pt-4">
        <Link
          href={backHref}
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>
        <h1 className="mt-2 text-3xl font-extrabold">{title}</h1>
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

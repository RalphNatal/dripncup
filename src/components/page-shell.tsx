import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Title block and single column for inner pages. The surrounding layout
 * provides `<main>`: the customer app shell for shop pages, the plain frame
 * for /staff and /admin.
 */
export function PageShell({
  title,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  /** Omit on top-level tabs; the tab bar is the way back. */
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md">
      {backHref ? (
        <Link
          href={backHref}
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {backLabel ?? "Back"}
        </Link>
      ) : null}
      <h1 className="mt-2 text-3xl font-extrabold">{title}</h1>
      <div className="mt-6">{children}</div>
    </div>
  );
}

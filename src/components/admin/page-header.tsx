import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/** Title row for admin pages: an optional way back, the title, and actions on the right. */
export function AdminPageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-6 space-y-2">
      {backHref ? (
        <Link
          href={backHref}
          className="focus-ring -ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          {backLabel ?? "Back"}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold text-balance">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A primary call to action styled like the rest of the app (deep teal, white text: 4.95:1). */
export function AdminButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
    >
      {children}
    </Link>
  );
}

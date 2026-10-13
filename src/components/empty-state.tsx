import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Swirl } from "@/components/brand/logo";

/**
 * Friendly "nothing here (yet)" panel used by empty and error states, with
 * the brand's swirl. `headingLevel` makes the title a real heading when the
 * panel is the whole page (not-found pages); inside a page it stays a
 * paragraph under the page's own headings.
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  headingLevel,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  headingLevel?: 1 | 2 | 3;
}) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : "p";
  return (
    <div className="rounded-3xl border border-dashed bg-card px-6 py-10 text-center">
      <Icon className="mx-auto size-10 text-brand-teal-deep" aria-hidden="true" />
      <Title className="mt-3 text-lg font-bold">{title}</Title>
      <Swirl className="mx-auto mt-1 h-4 text-brand-pink" />
      {children ? <div className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

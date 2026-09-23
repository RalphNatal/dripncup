import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Friendly "nothing here (yet)" panel used by empty and error states. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed bg-card px-6 py-10 text-center">
      <Icon className="mx-auto size-10 text-brand-teal-deep" aria-hidden="true" />
      <p className="mt-3 text-lg font-bold">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

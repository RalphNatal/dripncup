import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A small rounded status label; the words carry the meaning, the colour only helps. */
export function StatusPill({ tone = "neutral", children, testId }: { tone?: "good" | "warn" | "bad" | "neutral" | "info"; children: ReactNode; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        tone === "good" && "bg-brand-teal-soft text-brand-teal-deep",
        tone === "warn" && "bg-[color-mix(in_oklab,var(--warning)_18%,var(--card))] text-foreground",
        tone === "bad" && "bg-destructive/10 text-destructive",
        tone === "info" && "bg-brand-pink-soft text-brand-magenta-deep",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

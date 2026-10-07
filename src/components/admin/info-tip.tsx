"use client";

/**
 * A small (i) that opens a definition. A popover rather than a tooltip, so it
 * works by tap on a phone and by keyboard, and stays open while read.
 */
import { Info } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`What "${label}" means`}
        >
          <Info className="size-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs rounded-2xl text-sm leading-relaxed">
        <p className="font-semibold">{label}</p>
        <p className="mt-1 text-muted-foreground">{children}</p>
      </PopoverContent>
    </Popover>
  );
}

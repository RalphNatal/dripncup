"use client";

import { CloudOff } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/empty-state";

/** Next 16 passes `retry`, which re-fetches and re-renders the segment. */
export default function MenuError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={CloudOff}
      title="We couldn't load the menu"
      action={
        <button
          type="button"
          onClick={() => retry()}
          className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
        >
          Try again
        </button>
      }
    >
      Check your connection and try again. If it keeps happening, the cafe is still happy to take your order in
      person.
    </EmptyState>
  );
}

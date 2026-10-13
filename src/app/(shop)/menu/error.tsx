"use client";

import { ErrorPanel } from "@/components/error-panel";

/** Next 16 passes `retry`, which re-fetches and re-renders the segment. */
export default function MenuError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="py-8">
      <ErrorPanel
        {...props}
        title="We couldn't load the menu"
        message="Check your connection and try again. If it keeps happening, the cafe is still happy to take your order in person."
        homeLabel="Go home"
      />
    </div>
  );
}

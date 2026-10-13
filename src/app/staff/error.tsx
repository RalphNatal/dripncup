"use client";

import { ErrorPanel } from "@/components/error-panel";

/** The counter screen failed to load; staff need the fastest way back. */
export default function StaffError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="px-4 py-8">
      <ErrorPanel
        {...props}
        title="The queue didn't load"
        message="Check the tablet's connection, then try again. Orders already placed are safe and will show when it reloads."
        homeHref="/staff"
        homeLabel="Reload the queue"
      />
    </div>
  );
}

"use client";

import { ErrorPanel } from "@/components/error-panel";

/** An admin page failed; the sidebar stays. The code matches the server's log line. */
export default function AdminError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="py-8">
      <ErrorPanel
        {...props}
        title="This page didn't load"
        message="Nothing was changed. Try again; if it keeps failing, the code below helps find what went wrong."
        homeHref="/admin"
        homeLabel="Admin home"
      />
    </div>
  );
}

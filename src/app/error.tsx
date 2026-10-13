"use client";

import { ErrorPanel } from "@/components/error-panel";

/**
 * Last-resort friendly error page for anything below the root layout,
 * including the app shell itself (for example if the database is down).
 */
export default function AppError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main id="main" className="flex flex-1 flex-col justify-center px-4 py-16">
      <ErrorPanel {...props} message="We couldn't load this page. Please try again in a moment." />
    </main>
  );
}

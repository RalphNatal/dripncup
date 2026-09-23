"use client";

import { CloudOff } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { EmptyState } from "@/components/empty-state";

/**
 * Last-resort friendly error page for anything below the root layout,
 * including the app shell itself (for example if the database is down).
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <EmptyState
        icon={CloudOff}
        title="Something went wrong"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => retry()}
              className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
            >
              Try again
            </button>
            <Link href="/" className="focus-ring inline-flex min-h-11 items-center rounded-full border px-5 text-sm font-semibold hover:bg-muted">
              Go home
            </Link>
          </div>
        }
      >
        We couldn&apos;t load this page. Please try again in a moment.
      </EmptyState>
    </main>
  );
}

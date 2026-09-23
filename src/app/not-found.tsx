import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <EmptyState
        icon={Compass}
        title="We couldn't find that page"
        action={
          <Link
            href="/menu"
            className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
          >
            See the menu
          </Link>
        }
      >
        The link may be old, or the page has moved.
      </EmptyState>
    </main>
  );
}

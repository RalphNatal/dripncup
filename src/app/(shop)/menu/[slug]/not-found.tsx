import { SearchX } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

export default function ProductNotFound() {
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        icon={SearchX}
        title="That item isn't on the menu"
        action={
          <Link
            href="/menu"
            className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
          >
            See the menu
          </Link>
        }
      >
        It may have been a seasonal special, or the link has a typo.
      </EmptyState>
    </div>
  );
}

import { Compass } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

/** A customer page that doesn't exist (or isn't yours): inside the app shell. */
export default function ShopNotFound() {
  return (
    <div className="mx-auto w-full max-w-md py-8">
      <EmptyState
        icon={Compass}
        title="We couldn't find that page"
        headingLevel={1}
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
    </div>
  );
}

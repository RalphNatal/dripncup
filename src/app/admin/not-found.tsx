import { SearchX } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";

export default function AdminNotFound() {
  return (
    <div className="max-w-md py-8">
      <EmptyState
        icon={SearchX}
        title="That isn't here"
        headingLevel={1}
        action={
          <Link
            href="/admin"
            className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
          >
            Admin home
          </Link>
        }
      >
        It may have been deleted, or the link is out of date.
      </EmptyState>
    </div>
  );
}

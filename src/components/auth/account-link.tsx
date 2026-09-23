import { CircleUserRound } from "lucide-react";
import Link from "next/link";

import { getCurrentProfile } from "@/lib/auth/dal";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/80 px-4 text-sm font-semibold text-brand-teal-deep shadow-sm ring-1 ring-brand-teal/20 hover:bg-white";

/** "Sign in", or the customer's first name linking to their account. */
export async function AccountLink() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <Link href="/sign-in" className={linkClass}>
        Sign in
      </Link>
    );
  }

  return (
    <Link href="/account" className={linkClass}>
      <CircleUserRound className="size-4" aria-hidden="true" />
      <span className="max-w-[10rem] truncate">{profile.first_name ?? "Account"}</span>
      <span className="sr-only">— your account</span>
    </Link>
  );
}

/** Same footprint as the link, so the header does not jump when it resolves. */
export function AccountLinkSkeleton() {
  return <span className="inline-block h-11 w-24 rounded-full bg-white/60" aria-hidden="true" />;
}

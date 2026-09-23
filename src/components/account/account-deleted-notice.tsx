import { CircleCheck } from "lucide-react";

import { BRAND } from "@/lib/brand";

/** Shown on Home after `deleteAccount` redirects to `/?account=deleted`. */
export function AccountDeletedNotice() {
  return (
    <div
      role="status"
      className="flex gap-3 rounded-2xl border border-brand-teal/40 bg-brand-teal-soft p-4 text-sm text-foreground"
    >
      <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
      <div>
        <p className="font-semibold">Your account has been deleted.</p>
        <p className="mt-1">
          You&apos;ve been signed out. Mahalo for being part of {BRAND.name} — you&apos;re welcome back any
          time.
        </p>
      </div>
    </div>
  );
}

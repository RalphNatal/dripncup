import { CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DeleteAccountForm } from "@/components/account/delete-account-form";
import { PageShell } from "@/components/page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isLastAdmin } from "@/lib/auth/account-deletion";
import { requireProfile } from "@/lib/auth/dal";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = { title: "Delete account" };

/** The confirmation screen behind "Delete my account" on /account. */
export default async function DeleteAccountPage() {
  const profile = await requireProfile("/account/delete");
  const blocked = profile.role === "admin" && (await isLastAdmin(profile.id));

  return (
    <PageShell title="Delete your account" backHref="/account" backLabel="Account">
      <section aria-labelledby="what-happens" className="space-y-4 text-base">
        <h2 id="what-happens" className="text-xl font-bold">
          What happens
        </h2>
        <ul className="list-disc space-y-2 pl-5 marker:text-brand-magenta-deep">
          <li>
            Your profile and saved favorites are deleted
            {profile.loyalty_points > 0 ? (
              <>
                , along with your{" "}
                <strong>
                  {profile.loyalty_points} {BRAND.loyaltyProgramName} points
                </strong>
                . Points can&apos;t be restored.
              </>
            ) : (
              "."
            )}
          </li>
          <li>Any order that hasn&apos;t been picked up yet, and any open catering request, is cancelled.</li>
          <li>
            We keep past orders and catering records for our sales and tax reports, with your name, email,
            phone number and cup name removed.
          </li>
          <li>You&apos;ll be signed out everywhere. You can create a new account later, but it starts fresh.</li>
        </ul>
      </section>

      <div className="mt-8">
        {blocked ? (
          <Alert variant="destructive" className="rounded-xl">
            <CircleAlert aria-hidden="true" />
            <AlertTitle>You&apos;re the only admin</AlertTitle>
            <AlertDescription>
              Make another account an admin first, so someone can still manage the cafe. Then come back to
              delete yours.
            </AlertDescription>
          </Alert>
        ) : (
          <DeleteAccountForm />
        )}
      </div>

      <p className="mt-6 text-center text-sm">
        <Link
          href="/account"
          className="inline-flex min-h-11 items-center font-medium text-brand-teal-deep underline-offset-4 hover:underline"
        >
          Keep my account
        </Link>
      </p>
    </PageShell>
  );
}

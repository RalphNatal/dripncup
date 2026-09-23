import type { Metadata } from "next";

import { NewPasswordForm } from "@/components/auth/auth-forms";
import { PageShell } from "@/components/page-shell";
import { requireProfile } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Change password" };

/**
 * Also where a password-reset email lands: the callback route signs the
 * visitor in with the recovery link, then sends them here.
 */
export default async function ChangePasswordPage() {
  await requireProfile("/account/password");

  return (
    <PageShell title="Change password" backHref="/account" backLabel="Account">
      <NewPasswordForm />
    </PageShell>
  );
}

import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { requireProfile } from "@/lib/auth/dal";
import { getCateringRequest } from "@/lib/catering/queries";

/**
 * Someone else's catering request (or none) is a real 404 (RLS, then an
 * owner check), and a guest gets a real redirect to sign in.
 *
 * The check runs here, above the page's loading skeleton (route groups keep
 * the parent pages' skeletons off this route): once a skeleton has streamed
 * the status is already 200, and the not-found page could only arrive inside
 * it. The page reads the same row again from the per-request cache.
 */
export default async function CateringPayLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requireProfile(`/catering/${id}/pay`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const request = await getCateringRequest(id, profile);
  if (!request || request.userId !== profile.id) notFound();
  return children;
}

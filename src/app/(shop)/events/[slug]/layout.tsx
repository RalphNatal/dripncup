import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getPublicEvent } from "@/lib/events/queries";

/**
 * An unknown or unpublished pop-up is a real 404.
 *
 * The check runs here, above the page's loading skeleton (route groups keep
 * the parent pages' skeletons off this route): once a skeleton has streamed
 * the status is already 200, and the not-found page could only arrive inside
 * it. The page reads the same row again from the per-request cache.
 */
export default async function EventLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug) || !(await getPublicEvent(slug))) notFound();
  return children;
}

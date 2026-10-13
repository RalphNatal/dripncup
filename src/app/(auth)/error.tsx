"use client";

import { ErrorPanel } from "@/components/error-panel";

export default function AuthError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorPanel {...props} message="We couldn't load the sign-in form. Please try again in a moment." />;
}

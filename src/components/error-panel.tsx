"use client";

/**
 * The friendly face of every error boundary (error.tsx, global-error.tsx):
 * what happened in plain words, Try again, a way out, and a short reference
 * the cafe can match to the server's log line. Never the error's own text:
 * a Server Component's message is already replaced by Next in production,
 * and a browser error's message isn't for customers either.
 */
import { CloudOff, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Swirl } from "@/components/brand/logo";

export interface ErrorPanelProps {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  message?: string;
  homeHref?: string;
  homeLabel?: string;
  icon?: LucideIcon;
}

export function ErrorPanel({
  error,
  retry,
  title = "Something went wrong",
  message = "We couldn't load this page. Please try again in a moment.",
  homeHref = "/",
  homeLabel = "Go home",
  icon: Icon = CloudOff,
}: ErrorPanelProps) {
  useEffect(() => {
    // For whoever opens the browser console; the server logged its side.
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto w-full max-w-md rounded-3xl border border-dashed bg-card px-6 py-10 text-center">
      <Icon className="mx-auto size-10 text-brand-teal-deep" aria-hidden="true" />
      <h1 className="mt-3 text-2xl font-extrabold">{title}</h1>
      <Swirl className="mx-auto mt-1 h-5 text-brand-pink" />
      <p className="mx-auto mt-2 max-w-sm text-base text-muted-foreground">{message}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="focus-ring inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
        >
          Try again
        </button>
        <Link href={homeHref} className="focus-ring inline-flex min-h-11 items-center rounded-full border bg-card px-5 text-sm font-semibold hover:bg-muted">
          {homeLabel}
        </Link>
      </div>
      {error.digest ? (
        <p className="mt-6 text-xs text-muted-foreground">
          If it keeps happening, mention this code: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}

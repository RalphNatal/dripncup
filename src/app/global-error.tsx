"use client";

/**
 * When even the root layout fails. Next renders this instead of the whole
 * document, so it brings its own <html>, <body> and styles; it still looks
 * like Drincup (brand colours from the same stylesheet, system fonts).
 */
import { ErrorPanel } from "@/components/error-panel";
import { BRAND } from "@/lib/brand";

import "./globals.css";

export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-brand-wash text-foreground">
        <title>{`Something went wrong · ${BRAND.name}`}</title>
        <main id="main" className="flex flex-1 flex-col justify-center px-4 py-16">
          <p className="mb-6 text-center font-heading text-2xl font-extrabold lowercase text-brand-teal-deep">{BRAND.wordmark}</p>
          <ErrorPanel {...props} message="We couldn't load Drincup just now. Please try again in a moment." />
        </main>
      </body>
    </html>
  );
}

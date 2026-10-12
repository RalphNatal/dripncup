"use client";

/**
 * "Add Drincup to your home screen", offered once an order has gone through
 * (never on a first visit). Android and desktop Chrome/Edge get the
 * browser's own install dialog; iPhone and iPad, which have no such dialog,
 * get the two steps to do it by hand. Hidden when already installed, when
 * the browser can't install, and for good once dismissed or installed.
 */
import { Share, Smartphone, SquarePlus, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import { installPromptAnswered, isIos, isStandalone, promptInstall, rememberInstallPrompt, useCanPromptInstall } from "@/lib/pwa/client";

const noSubscription = () => () => undefined;

/** Read once after hydration: platform and the remembered answer (the server can't know either). */
function useInstallContext() {
  return useSyncExternalStore(
    noSubscription,
    () => (isStandalone() ? "installed" : installPromptAnswered() ? "answered" : isIos() ? "ios" : "other"),
    () => "installed" as const,
  );
}

export function InstallPrompt() {
  const context = useInstallContext();
  const canPrompt = useCanPromptInstall();
  const [closed, setClosed] = useState(false);

  if (closed || context === "installed" || context === "answered") return null;
  if (context === "other" && !canPrompt) return null;

  const dismiss = () => {
    rememberInstallPrompt("dismissed");
    setClosed(true);
  };

  return (
    <section
      aria-labelledby="install-heading"
      data-testid="install-prompt"
      className="relative mt-6 rounded-3xl border border-brand-teal-deep/30 bg-brand-teal-soft p-4 pr-12 sm:p-5 sm:pr-14"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="focus-ring absolute top-1.5 right-1.5 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-white/60 hover:text-foreground"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
      <h2 id="install-heading" className="flex items-center gap-2 text-lg font-bold">
        <Smartphone className="size-5 text-brand-teal-deep" aria-hidden="true" />
        Add Drincup to your home screen
      </h2>
      <p className="mt-1 text-sm">Order again in a couple of taps, and get a notification when your drink is ready.</p>

      {context === "ios" ? (
        <ol className="mt-3 space-y-2 text-sm" data-testid="install-ios-steps">
          <li className="flex items-center gap-2">
            <Share className="size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
            <span>
              Tap <strong>Share</strong> in Safari&apos;s toolbar.
            </span>
          </li>
          <li className="flex items-center gap-2">
            <SquarePlus className="size-5 shrink-0 text-brand-teal-deep" aria-hidden="true" />
            <span>
              Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </span>
          </li>
        </ol>
      ) : (
        <button
          type="button"
          onClick={async () => {
            const outcome = await promptInstall();
            if (outcome === "accepted") rememberInstallPrompt("installed");
            setClosed(true);
          }}
          className="focus-ring mt-3 inline-flex min-h-11 items-center rounded-full bg-brand-teal-deep px-5 text-sm font-semibold text-white hover:bg-brand-teal-deep/90"
        >
          Add to home screen
        </button>
      )}
    </section>
  );
}

"use client";

/**
 * Mounted once at the root: registers the service worker, holds on to the
 * browser's install prompt (offered after an order, never on a first
 * visit), and shows "A new version is available. Refresh" when a deploy is
 * waiting. The switch to the new version only happens when the customer
 * taps Refresh, never in the middle of what they're doing.
 */
import { RefreshCw, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { applyUpdate, captureInstallPrompt, checkForUpdate, registerServiceWorker, useServiceWorker } from "@/lib/pwa/client";

export function PwaManager() {
  const pathname = usePathname();
  const { updateReady } = useServiceWorker();
  const [hiddenOn, setHiddenOn] = useState<string | null>(null);

  useEffect(() => {
    captureInstallPrompt();
    void registerServiceWorker();
  }, []);

  // A deploy is noticed on the next route change too, not only every 30 minutes.
  useEffect(() => {
    void checkForUpdate();
  }, [pathname]);

  // "Later" hides it on this page; it comes back on the next one.
  if (!updateReady || hiddenOn === pathname) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-tabbar z-50 flex justify-center px-4 pb-3 md:bottom-0 md:pb-6 print:hidden">
      <div
        role="status"
        data-testid="update-prompt"
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl bg-brand-ink py-2 pr-2 pl-4 text-sm text-white shadow-lg"
      >
        <p className="flex-1 font-medium">A new version is available.</p>
        <button
          type="button"
          onClick={applyUpdate}
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 font-semibold text-brand-ink hover:bg-white/90"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => setHiddenOn(pathname)}
          aria-label="Later"
          className="focus-ring inline-flex size-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

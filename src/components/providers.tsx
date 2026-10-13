"use client";

/**
 * What every page mounts once at the root: the toast area (loaded when the
 * browser is idle, since nothing in a first paint needs it; src/lib/toast.ts)
 * and the PWA manager. The cart is Zustand and persists itself, so it needs
 * no provider. TanStack Query is not here: the few live parts that use it
 * bring their own provider over one shared client (src/lib/query-client.tsx),
 * so pages without them don't load it.
 */
import type { ReactNode } from "react";

import { LazyToaster } from "@/components/lazy-toaster";
import { PwaManager } from "@/components/pwa/pwa-manager";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LazyToaster />
      <PwaManager />
    </>
  );
}

"use client";

/**
 * Client-side providers mounted once at the root.
 *
 * TanStack Query owns all server data. The cart is Zustand and persists itself,
 * so it needs no provider. The toast area loads when the browser is idle:
 * nothing in a first paint needs it (src/lib/toast.ts).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { LazyToaster } from "@/components/lazy-toaster";
import { PwaManager } from "@/components/pwa/pwa-manager";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /**
         * A menu price that is one minute stale is fine to render; checkout
         * re-validates everything server-side anyway, so freshness here is a
         * UX concern rather than a correctness one.
         */
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  // Created in state so each browser session gets exactly one client, and so
  // it is never shared between requests during SSR.
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <LazyToaster />
      <PwaManager />
    </QueryClientProvider>
  );
}

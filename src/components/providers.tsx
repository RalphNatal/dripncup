"use client";

/**
 * Client-side providers mounted once at the root.
 *
 * TanStack Query owns all server data. The cart is Zustand and persists itself,
 * so it needs no provider.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

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
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

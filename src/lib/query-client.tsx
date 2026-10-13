"use client";

/**
 * TanStack Query for the parts of the app that keep server data live: the
 * order tracker, the active-order cards and the Orders-tab dot, and the
 * staff screen. Not a root provider: each of those wraps itself in
 * QueryProvider, so the library loads only on pages that use it (a guest
 * on the menu never downloads it). Every provider in the browser hands out
 * the same client, so the tab dot, the Home cards and the tracker still
 * share one cache. On the server each render gets its own client, never
 * shared between requests.
 */
import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";
import type { ReactNode } from "react";

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

let browserClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  return (browserClient ??= makeQueryClient());
}

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}

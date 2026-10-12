"use client";

/**
 * The customer app's "Offline" banner, under the header whenever the
 * browser loses its connection (the same signal the staff screen uses). The
 * page may be the last saved copy; ordering and paying are blocked until
 * the connection is back (checkout and the cart check useOnline too).
 */
import { WifiOff } from "lucide-react";

import { useOnline } from "@/lib/hooks/use-online";

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" data-testid="offline-banner" className="bg-brand-ink text-white">
      <p className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2 text-sm">
        <WifiOff className="size-4 shrink-0" aria-hidden="true" />
        <span>
          <span className="font-bold">Offline.</span> You may be seeing a saved copy of this page. Your cart is saved; reconnect to
          place your order.
        </span>
      </p>
    </div>
  );
}

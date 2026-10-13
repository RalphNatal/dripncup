"use client";

import { ErrorPanel } from "@/components/error-panel";

/** A customer page failed; the header and tab bar stay, so there's always a way on. */
export default function ShopError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="py-8">
      <ErrorPanel
        {...props}
        title="Oops, that didn't pour right"
        message="We couldn't load this page. Check your connection and try again. Your cart is safe."
        homeHref="/menu"
        homeLabel="See the menu"
      />
    </div>
  );
}

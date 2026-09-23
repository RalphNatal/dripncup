import type { Metadata } from "next";

import { CartPlaceholder } from "@/components/cart/cart-placeholder";
import { PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Cart" };

/**
 * Stand-in so the header's cart icon has somewhere to go. The real cart --
 * editing lines, promo codes, tax, tip -- is Phase 4.
 */
export default function CartPage() {
  return (
    <PageShell title="Your cart" backHref="/menu" backLabel="Menu">
      <CartPlaceholder />
    </PageShell>
  );
}

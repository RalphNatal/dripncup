import type { ReactNode } from "react";

/**
 * `modal` is the @modal parallel route. Opening a product from the menu is a
 * client-side navigation to /menu/[slug], which @modal/(.)[slug] intercepts
 * and shows as a sheet over the menu. Visiting /menu/[slug] directly (a
 * shared link, a refresh) is not intercepted, so the full page renders.
 */
export default function MenuLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}

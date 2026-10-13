"use client";

/**
 * Moves focus to the page after a client-side navigation, so keyboard and
 * screen-reader users start at the new content instead of on a tab-bar link
 * (or nowhere, when the link they used is gone). Next announces the new
 * title; this puts the reading position with it.
 *
 * Left alone: the first load; a change of search params only; a navigation
 * that opened a dialog (the product sheet takes focus itself); and any time
 * focus is already inside the page (a sheet closing hands it back to the
 * card that opened it).
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function RouteFocus({ target = "main" }: { target?: string }) {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // After the new page (and any dialog) has rendered.
    const timer = window.setTimeout(() => {
      const main = document.getElementById(target);
      if (!main) return;
      const active = document.activeElement;
      if (active && active !== document.body && (main.contains(active) || active.closest("[role=dialog]"))) return;
      if (document.querySelector("[role=dialog]")) return;
      main.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [pathname, target]);

  return null;
}

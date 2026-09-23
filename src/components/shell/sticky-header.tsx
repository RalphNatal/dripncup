"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The sticky app header. It publishes its own height as `--header-h`, so
 * things that stick beneath it (the menu's category chips, section scroll
 * offsets) line up exactly, whatever the content wraps to at a given width
 * or text size.
 */
export function StickyHeader({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const publish = () =>
      document.documentElement.style.setProperty("--header-h", `${header.getBoundingClientRect().height}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      ref={ref}
      className="sticky top-0 z-40 border-b bg-background/95 pt-safe backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      {children}
    </header>
  );
}

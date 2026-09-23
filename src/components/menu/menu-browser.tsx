"use client";

/**
 * The browsable menu: search, sticky category chips that follow the scroll,
 * and a section per category. Everything shown comes from props built on the
 * server; nothing here knows what a "latte" is.
 */
import { Search, SearchX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { ProductCard } from "@/components/menu/product-card";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import type { MenuSection } from "@/lib/menu/model";
import { matchesSearch } from "@/lib/menu/search";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 200;

const sectionId = (slug: string) => `menu-${slug}`;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MenuBrowser({
  sections,
  featured,
}: {
  sections: MenuSection[];
  /** Shown under the search box, and hidden while searching (the seasonal banner). */
  featured?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const searching = debouncedQuery.trim().length > 0;

  const visibleSections = useMemo(() => {
    if (!searching) return sections;
    return sections
      .map((section) => ({
        ...section,
        products: section.products.filter((p) => matchesSearch(debouncedQuery, [p.name, p.description])),
      }))
      .filter((section) => section.products.length > 0);
  }, [sections, debouncedQuery, searching]);

  const resultCount = visibleSections.reduce((sum, s) => sum + s.products.length, 0);

  // ---- Which section is on screen ----------------------------------------
  const [activeSlug, setActiveSlug] = useState<string | null>(sections[0]?.slug ?? null);
  const chipBarRef = useRef<HTMLElement>(null);
  const chipListRef = useRef<HTMLUListElement>(null);
  const currentSlug = visibleSections.some((s) => s.slug === activeSlug) ? activeSlug : (visibleSections[0]?.slug ?? null);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = (chipBarRef.current?.getBoundingClientRect().bottom ?? 0) + 12;
      let current = visibleSections[0]?.slug ?? null;
      for (const section of visibleSections) {
        const el = document.getElementById(sectionId(section.slug));
        if (el && el.getBoundingClientRect().top <= line) current = section.slug;
      }
      // At the very bottom the last section may be too short to reach the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = visibleSections.at(-1)?.slug ?? current;
      }
      setActiveSlug(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [visibleSections]);

  // Keep the active chip in view within the horizontal strip.
  useEffect(() => {
    const list = chipListRef.current;
    const chip = list?.querySelector<HTMLElement>(`[data-slug="${currentSlug}"]`);
    if (!list || !chip) return;
    const target = chip.offsetLeft - (list.clientWidth - chip.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, target), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [currentSlug]);

  const jumpTo = useCallback((event: MouseEvent<HTMLAnchorElement>, slug: string) => {
    const section = document.getElementById(sectionId(slug));
    if (!section) return;
    event.preventDefault();
    section.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
    // Move keyboard and screen-reader focus to the section too.
    section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    setActiveSlug(slug);
  }, []);

  return (
    <div>
      <div className="relative">
        <label htmlFor="menu-search" className="sr-only">
          Search the menu
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id="menu-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search drinks and snacks"
          autoComplete="off"
          enterKeyHint="search"
          className="focus-ring h-12 w-full rounded-full border bg-card pr-12 pl-12 text-base placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="focus-ring absolute top-1/2 right-1 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            aria-label="Clear search"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {searching ? (resultCount === 0 ? "No matches" : `${resultCount} ${resultCount === 1 ? "match" : "matches"}`) : ""}
      </p>

      {featured && !searching ? <div className="mt-4">{featured}</div> : null}

      {visibleSections.length > 0 ? (
        <nav
          ref={chipBarRef}
          aria-label="Menu categories"
          className="sticky top-header z-30 -mx-4 mt-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:mx-0 md:rounded-b-2xl"
        >
          <ul ref={chipListRef} className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2">
            {visibleSections.map((section) => {
              const active = section.slug === currentSlug;
              return (
                <li key={section.id} data-slug={section.slug} className="shrink-0">
                  <a
                    href={`#${sectionId(section.slug)}`}
                    onClick={(e) => jumpTo(e, section.slug)}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "focus-ring inline-flex h-11 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors",
                      active
                        ? "border-brand-teal-deep bg-brand-teal-deep text-white"
                        : "bg-card text-foreground hover:border-brand-teal-deep/40",
                    )}
                  >
                    {section.name}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}

      {visibleSections.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed bg-card px-6 py-10 text-center">
          <SearchX className="mx-auto size-10 text-brand-teal-deep" aria-hidden="true" />
          <p className="mt-3 text-lg font-bold">No matches for “{debouncedQuery.trim()}”</p>
          <p className="mt-1 text-sm text-muted-foreground">Try a flavor, like mango or vanilla, or a drink type, like latte.</p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="focus-ring mt-5 inline-flex min-h-11 items-center rounded-full border px-5 text-sm font-semibold hover:bg-muted"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-8">
          {visibleSections.map((section) => (
            <section
              key={section.id}
              id={sectionId(section.slug)}
              aria-labelledby={`${sectionId(section.slug)}-heading`}
              className="scroll-mt-[calc(var(--header-h)+4.25rem)]"
            >
              <h2
                id={`${sectionId(section.slug)}-heading`}
                tabIndex={-1}
                className="text-2xl font-extrabold outline-none"
              >
                {section.name}
              </h2>
              {section.description ? <p className="text-sm text-muted-foreground">{section.description}</p> : null}
              <ul className="mt-3 grid gap-3 md:grid-cols-2">
                {section.products.map((product) => (
                  <li key={product.id}>
                    <ProductCard product={product} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Skip to content": the first thing Tab reaches on every page, hidden until
 * focused. `target` is the id of the frame's <main>, which takes focus
 * (tabIndex -1) so the next Tab continues inside the page.
 */
export function SkipLink({ target = "main" }: { target?: string }) {
  return (
    <a
      href={`#${target}`}
      className="focus-ring sr-only z-50 rounded-full bg-brand-teal-deep px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      Skip to content
    </a>
  );
}

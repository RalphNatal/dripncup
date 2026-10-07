/* eslint-disable @next/next/no-img-element -- the logo is a small public Storage image; next/image's optimiser refuses local Storage URLs */
import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * Wordmark lockup.
 *
 * The owner uploads the real logo on /admin/content (site_content
 * logo_path); until then the wordmark is typeset (NEEDS_CONFIRMATION).
 * `src` is that upload's public URL, read on the server.
 */
export function Logo({
  className,
  size = "md",
  showTagline = false,
  src = null,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  src?: string | null;
}) {
  const wordmarkSize = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
  }[size];
  const imageHeight = { sm: "h-8", md: "h-10", lg: "h-16" }[size];

  return (
    <div className={cn("flex flex-col", className)}>
      {src ? (
        <img src={src} alt={BRAND.name} className={cn("w-auto max-w-48 object-contain", imageHeight)} />
      ) : (
      <span
        className={cn(
          "font-heading font-extrabold lowercase leading-none tracking-tight text-brand-teal-deep",
          wordmarkSize,
        )}
      >
        {BRAND.wordmark}
      </span>
      )}
      {showTagline ? (
        <span className="mt-1 text-xs font-medium text-muted-foreground">
          {BRAND.taglines.primary}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Loose hand-drawn swirl used as a decorative accent, echoing the scribbles on
 * the current site. Purely ornamental, so it is hidden from assistive tech.
 */
export function Swirl({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 40"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("h-6 w-auto", className)}
    >
      <path
        d="M4 28c10-14 22-18 30-10s-2 20 6 20 14-14 22-20 18-6 24 2"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

import { cn } from "@/lib/utils";
import { BRAND } from "@/lib/brand";

/**
 * Wordmark lockup.
 *
 * NEEDS_CONFIRMATION: this is a type-set placeholder. Drop the real logo files
 * into `public/brand/` and swap the mark below for an <Image>; the sizing and
 * spacing API here is meant to survive that change.
 */
export function Logo({
  className,
  size = "md",
  showTagline = false,
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
}) {
  const wordmarkSize = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-4xl",
  }[size];

  return (
    <div className={cn("flex flex-col", className)}>
      <span
        className={cn(
          "font-heading font-extrabold lowercase leading-none tracking-tight text-brand-teal-deep",
          wordmarkSize,
        )}
      >
        {BRAND.wordmark}
      </span>
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

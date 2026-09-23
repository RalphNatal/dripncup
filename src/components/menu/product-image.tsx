import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * A product photo from Supabase Storage, or -- until the cafe supplies real
 * photography (NEEDS_CONFIRMATION) -- a generated placeholder in brand
 * colours: a hand-drawn cup on a soft wash, picked per product so the grid
 * does not look like one repeated tile. Original artwork, local, no remote
 * stock images.
 */

const PALETTES = [
  { wash: "var(--brand-teal-soft)", cup: "var(--brand-teal-deep)", accent: "var(--brand-magenta)" },
  { wash: "var(--brand-pink-soft)", cup: "var(--brand-magenta-deep)", accent: "var(--brand-teal)" },
  { wash: "var(--brand-sand)", cup: "var(--brand-teal-deep)", accent: "var(--brand-pink)" },
] as const;

function paletteFor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTES[hash % PALETTES.length];
}

/** Local Supabase serves Storage from 127.0.0.1; skip the optimiser there. */
function isLoopback(src: string): boolean {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(src).hostname);
  } catch {
    return false;
  }
}

export function ProductImage({
  src,
  alt,
  seed,
  sizes,
  priority = false,
  className,
}: {
  src: string | null;
  /** "" when the product name is already right next to the image. */
  alt: string;
  /** Stable per product (the slug), so each keeps its placeholder colour. */
  seed: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  if (src) {
    return (
      <div className={cn("relative overflow-hidden bg-muted", className)}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          unoptimized={isLoopback(src)}
          className="object-cover"
        />
      </div>
    );
  }

  const palette = paletteFor(seed);
  return (
    <div
      className={cn("relative flex items-center justify-center overflow-hidden", className)}
      style={{ backgroundColor: palette.wash }}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <svg viewBox="0 0 120 120" className="h-3/4 w-auto" fill="none" aria-hidden="true" focusable="false">
        {/* swirl behind the cup, like the scribbles on the cafe's site */}
        <path
          d="M14 84c10-18 24-22 32-12s-4 24 8 24 16-20 28-26 22-4 26 6"
          stroke={palette.accent}
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.55"
        />
        {/* straw */}
        <path d="M68 16l-6 26" stroke={palette.cup} strokeWidth="5" strokeLinecap="round" />
        {/* lid */}
        <rect x="34" y="38" width="52" height="9" rx="4.5" fill={palette.cup} />
        {/* cup */}
        <path d="M38 50h44l-5 46a7 7 0 0 1-7 6H50a7 7 0 0 1-7-6l-5-46z" fill={palette.cup} />
        {/* label band */}
        <path d="M41 66h38l-1.6 16H42.6z" fill="var(--background)" opacity="0.9" />
        <circle cx="60" cy="74" r="4" fill={palette.accent} />
      </svg>
    </div>
  );
}

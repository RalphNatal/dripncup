/**
 * Accent colour checks for the collection form, pure.
 *
 * A collection's accent is decoration: the banner's stripe, a soft circle,
 * a tinted border, never text (brand accessibility rule, Decisions Log
 * Phase 1). The admin is warned when the colour would fail WCAG AA as text,
 * so nobody is tempted to use it that way later.
 */

/** "#e0409b" / "#E0409B" -> "#E0409B"; null for anything that is not #RRGGBB. */
export function normalizeHexColor(value: string): string | null {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : null;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const normalized = normalizeHexColor(hex);
  if (!normalized) throw new RangeError(`Not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(normalized.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export interface AccentCheck {
  /** Contrast against white: white text on the colour, or the colour as text on a white card (the same ratio). */
  ratio: number;
  /** AA for body text (4.5:1) either way round. */
  passesForText: boolean;
  /** AA for large text and UI parts (3:1) either way round. */
  passesForLargeText: boolean;
}

export function checkAccentColor(hex: string): AccentCheck {
  const ratio = contrastRatio(hex, "#FFFFFF");
  return {
    ratio,
    passesForText: ratio >= 4.5,
    passesForLargeText: ratio >= 3,
  };
}

/** "3.90:1", truncated (never rounded up past a threshold: 4.49 is not "4.5"). */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

/**
 * A QR code drawn as one SVG path from uqr's module matrix: no canvas, no
 * image request, crisp at any size, and it renders on the server too. Dark
 * modules on white with a quiet zone, which every scanner expects.
 */
import { encode } from "uqr";

export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { data, size } = encode(value, { ecc: "M", border: 2 });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={className}
      data-testid="member-qr"
      data-value={value}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

/**
 * The per-icon modules of lucide-react carry the raw SVG data
 * (`__iconData`) that `npm run brand:assets` draws the manifest shortcut
 * icons from; the package ships no types for these deep imports.
 */
type LucideIconData = { name: string; size: number; node: Array<[string, Record<string, string>]> };

declare module "lucide-react/dist/esm/icons/cup-soda.mjs" {
  export const __iconData: LucideIconData;
}
declare module "lucide-react/dist/esm/icons/gift.mjs" {
  export const __iconData: LucideIconData;
}
declare module "lucide-react/dist/esm/icons/receipt.mjs" {
  export const __iconData: LucideIconData;
}

import { ProductSkeleton } from "@/components/menu/skeletons";

/**
 * Shown while the product loads after a tap on a card. A static stand-in for
 * the sheet (no focus trap needed for the moment it is up).
 */
export default function ProductSheetLoading() {
  return (
    <div className="fixed inset-0 z-50 bg-brand-ink/45">
      <div className="fixed inset-x-0 bottom-0 max-h-[92dvh] overflow-hidden rounded-t-[1.75rem] bg-background md:inset-auto md:top-1/2 md:left-1/2 md:w-[min(42rem,calc(100vw-4rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.75rem]">
        <ProductSkeleton inset />
      </div>
    </div>
  );
}

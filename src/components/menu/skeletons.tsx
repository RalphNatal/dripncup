import { Skeleton } from "@/components/ui/skeleton";

/** Loading placeholders shaped like what they stand in for, so nothing jumps. */

export function MenuSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the menu" className="space-y-4">
      <Skeleton className="h-9 w-32 rounded-xl" />
      <Skeleton className="h-12 w-full rounded-full" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      {Array.from({ length: 2 }, (_, section) => (
        <div key={section} className="space-y-3 pt-2">
          <Skeleton className="h-7 w-48 rounded-lg" />
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <ProductCardSkeleton key={i} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-3xl border bg-card p-3">
      <Skeleton className="size-24 shrink-0 rounded-2xl md:size-28" />
      <div className="flex flex-1 flex-col gap-2 py-1">
        <Skeleton className="h-5 w-3/4 rounded-md" />
        <Skeleton className="h-4 w-full rounded-md" />
        <Skeleton className="mt-auto h-4 w-20 rounded-md" />
      </div>
    </div>
  );
}

/** The product form, for the full page and inside the sheet. */
export function ProductSkeleton({ inset = false }: { inset?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-6">
      <Skeleton className={inset ? "aspect-[16/9] w-full rounded-none" : "aspect-[16/9] w-full rounded-3xl"} />
      <div className={inset ? "space-y-6 px-5 pb-6" : "space-y-6"}>
        <div className="space-y-2">
          <Skeleton className="h-8 w-2/3 rounded-lg" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-24 rounded-md" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-6 w-32 rounded-md" />
            <Skeleton className="h-36 w-full rounded-2xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

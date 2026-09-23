import { ProductSkeleton } from "@/components/menu/skeletons";

export default function ProductLoading() {
  return (
    <div className="mx-auto max-w-2xl pt-12">
      <ProductSkeleton />
    </div>
  );
}

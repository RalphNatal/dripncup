import { ProductSheet, ProductSheetNotFound } from "@/components/menu/product-sheet";
import { getProductPageData } from "@/lib/menu/queries";

/**
 * Intercepts /menu/[slug] when it is opened from the menu and shows the
 * product as a sheet over it. Direct visits render ../../[slug]/page.tsx.
 */
export default async function ProductModal({ params }: { params: Promise<{ slug: string }> }) {
  const data = await getProductPageData((await params).slug);
  return data ? <ProductSheet {...data} /> : <ProductSheetNotFound />;
}

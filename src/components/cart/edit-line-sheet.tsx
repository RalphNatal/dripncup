"use client";

/**
 * "Edit" on a cart line: reopens the product sheet with that line's choices
 * and saves back into the same line. Opened by a real trigger button, so
 * Radix returns focus to it when the sheet closes.
 */
import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ProductCustomizer } from "@/components/menu/product-customizer";
import { ProductSkeleton } from "@/components/menu/skeletons";
import {
  SheetDialog,
  SheetDialogContent,
  SheetDialogTitle,
  SheetDialogTrigger,
} from "@/components/shell/sheet-dialog";
import { useCartStore, type CartLine } from "@/lib/cart/store";
import { loadProductForEditAction } from "@/lib/checkout/actions";
import type { ProductPageData } from "@/lib/menu/queries";

type Loaded = { state: "loading" } | { state: "missing" } | { state: "ready"; data: ProductPageData };

export function EditLineSheet({ line }: { line: CartLine }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const replaceLine = useCartStore((s) => s.replaceLine);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLoaded({ state: "loading" });
      void loadProductForEditAction(line.productSlug).then((data) =>
        setLoaded(data ? { state: "ready", data } : { state: "missing" }),
      );
    }
  }

  return (
    <SheetDialog open={open} onOpenChange={onOpenChange}>
      <SheetDialogTrigger asChild>
        <button
          type="button"
          className="focus-ring inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-brand-teal-deep hover:bg-brand-teal-soft"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Edit
          <span className="sr-only"> {line.productName}</span>
        </button>
      </SheetDialogTrigger>

      <SheetDialogContent
        closeLabel={`Close editing ${line.productName}`}
        {...(loaded.state === "ready" && loaded.data.detail.product.description ? {} : { "aria-describedby": undefined })}
      >
        {loaded.state === "loading" ? (
          <>
            <SheetDialogTitle className="sr-only">Editing {line.productName}</SheetDialogTitle>
            <div className="overflow-y-auto">
              <ProductSkeleton inset />
            </div>
          </>
        ) : loaded.state === "missing" ? (
          <div className="px-6 pt-6 pb-10 text-center">
            <SheetDialogTitle className="text-xl font-bold">{line.productName} isn&apos;t on the menu</SheetDialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">Remove it from your cart to check out.</p>
          </div>
        ) : (
          <ProductCustomizer
            detail={loaded.data.detail}
            location={loaded.data.location}
            ordering={loaded.data.ordering}
            layout="sheet"
            onAdded={() => setOpen(false)}
            editing={{
              sizeId: line.sizeId,
              selection: line.selection,
              quantity: line.quantity,
              specialInstructions: line.specialInstructions,
              onSave: (updated) => {
                replaceLine(line.id, updated);
                toast.success(`Updated ${updated.productName}`);
              },
            }}
          />
        )}
      </SheetDialogContent>
    </SheetDialog>
  );
}

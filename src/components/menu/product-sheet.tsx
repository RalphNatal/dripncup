"use client";

/**
 * The product customiser as a sheet (phones) / dialog (desktop), shown when a
 * product is opened from the menu. The URL is still /menu/[slug], so it can
 * be shared; opening that link directly renders the full page instead.
 */
import { SearchX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ProductCustomizer } from "@/components/menu/product-customizer";
import {
  SheetDialog,
  SheetDialogContent,
  SheetDialogTitle,
  useRouteDialogFocus,
} from "@/components/shell/sheet-dialog";
import type { ProductPageData } from "@/lib/menu/queries";

export function ProductSheet({ detail, location, ordering }: ProductPageData) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const focus = useRouteDialogFocus();

  // Closing goes back to the menu underneath: the scroll position is kept and
  // focus returns to the card that opened the sheet.
  const close = () => {
    setOpen(false);
    router.back();
  };

  return (
    <SheetDialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <SheetDialogContent
        {...focus}
        closeLabel={`Close ${detail.product.name}`}
        // Radix links the description automatically when there is one.
        {...(detail.product.description ? {} : { "aria-describedby": undefined })}
      >
        <ProductCustomizer detail={detail} location={location} ordering={ordering} layout="sheet" onAdded={close} />
      </SheetDialogContent>
    </SheetDialog>
  );
}

/** The slug no longer exists (removed from the menu since the page loaded). */
export function ProductSheetNotFound() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const focus = useRouteDialogFocus();

  return (
    <SheetDialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setOpen(false);
        router.back();
      }}
    >
      <SheetDialogContent {...focus} aria-describedby={undefined}>
        <div className="px-6 pt-6 pb-10 text-center">
          <SearchX className="mx-auto size-10 text-brand-teal-deep" aria-hidden="true" />
          <SheetDialogTitle className="mt-3 text-xl font-bold">That item isn&apos;t on the menu</SheetDialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">It may have been a seasonal special.</p>
        </div>
      </SheetDialogContent>
    </SheetDialog>
  );
}
